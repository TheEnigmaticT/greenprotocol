import OpenAI from 'openai'
import {
  CompatibleModelConfigurationError,
  LEGACY_QWEN_MODEL,
  OPENROUTER_COMPATIBLE_BASE_URL,
  resolveQwenModelRuntime,
} from '@/lib/model-runtime'

export const QWEN_MODEL = LEGACY_QWEN_MODEL

const REQUEST_TIMEOUT_MS = 120_000
const DEFAULT_DEADLINE_MS = 120_000
const MAX_ATTEMPTS = 3
const RETRY_BACKOFF_MS = [250, 500]

export interface QwenCall {
  system: string
  userContent: string
  schema: Record<string, unknown>
  label: string
}

/** Test seam for retry callback and deadline behavior; callers use defaults. */
export interface QwenRetryRuntime {
  deadlineMs?: number
  maxAttempts?: number
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

export interface QwenResult<T> {
  input: T
  usage: { input_tokens: number; output_tokens: number }
  stop_reason: string
  content: Array<{ type: 'tool_use'; name: 'return_result'; input: T }>
}

interface CompatibleToolCall {
  type?: string
  function?: { name?: string; arguments?: string }
}

interface CompatibleCompletion {
  choices?: Array<{
    finish_reason?: string | null
    message?: { tool_calls?: CompatibleToolCall[] }
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export class QwenTransportError extends Error {
  constructor(label: string, reason: string) {
    super(`Qwen transport failed for ${label}: ${reason}`)
    this.name = 'QwenTransportError'
  }
}

class RetryableProviderError extends Error {
  constructor() {
    super('retryable provider failure')
    this.name = 'RetryableProviderError'
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function isRetryableProviderCallback(error: unknown): boolean {
  if (error instanceof RetryableProviderError) return true
  if (!error || typeof error !== 'object') return false

  const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined
  if (status === 408 || status === 409 || status === 425 || status === 429 || (status !== undefined && status >= 500 && status <= 599)) {
    return true
  }

  const name = 'name' in error && typeof error.name === 'string' ? error.name : ''
  return name === 'APIConnectionError' || name === 'APIConnectionTimeoutError' || name === 'AbortError'
}

function boundedAttempts(value: number | undefined): number {
  if (value === undefined) return MAX_ATTEMPTS
  return Math.max(1, Math.floor(value))
}

async function requestWithBoundedRetry(
  callback: () => Promise<CompatibleCompletion>,
  label: string,
  runtime: QwenRetryRuntime,
): Promise<CompatibleCompletion> {
  const now = runtime.now ?? Date.now
  const sleep = runtime.sleep ?? defaultSleep
  const deadlineMs = Math.max(0, runtime.deadlineMs ?? DEFAULT_DEADLINE_MS)
  const maxAttempts = boundedAttempts(runtime.maxAttempts)
  const startedAt = now()

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await callback()
      if (response.choices?.[0]?.finish_reason !== 'error') return response
      throw new RetryableProviderError()
    } catch (error) {
      if (!isRetryableProviderCallback(error)) {
        if (error instanceof QwenTransportError) throw error
        throw new QwenTransportError(label, 'provider request failed')
      }

      if (attempt + 1 >= maxAttempts) {
        throw new QwenTransportError(label, 'provider unavailable after bounded retries')
      }

      const delay = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]
      if (now() - startedAt + delay > deadlineMs) {
        throw new QwenTransportError(label, 'provider retry deadline exceeded')
      }
      await sleep(delay)
    }
  }

  throw new QwenTransportError(label, 'provider unavailable after bounded retries')
}

function parseForcedToolResult<T>(response: CompatibleCompletion, label: string): QwenResult<T> {
  const choice = response.choices?.[0]
  if (!choice) throw new QwenTransportError(label, 'provider returned no completion')
  if (choice.finish_reason === 'length') {
    throw new QwenTransportError(label, 'response truncated before return_result')
  }

  const toolCall = choice.message?.tool_calls?.find(call =>
    call.type === 'function' && call.function?.name === 'return_result',
  )
  if (!toolCall?.function) {
    throw new QwenTransportError(label, 'provider did not return return_result')
  }
  if (typeof toolCall.function.arguments !== 'string') {
    throw new QwenTransportError(label, 'return_result arguments were not valid JSON')
  }

  let input: T
  try {
    const parsed: unknown = JSON.parse(toolCall.function.arguments)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    input = parsed as T
  } catch {
    throw new QwenTransportError(label, 'return_result arguments were not valid JSON')
  }

  return {
    input,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
    stop_reason: choice.finish_reason ?? 'unknown',
    content: [{ type: 'tool_use', name: 'return_result', input }],
  }
}

export async function callQwen<T>(
  { system, userContent, schema, label }: QwenCall,
  runtime: QwenRetryRuntime = {},
): Promise<QwenResult<T>> {
  let config
  try {
    config = resolveQwenModelRuntime()
  } catch (error) {
    const reason = error instanceof CompatibleModelConfigurationError
      ? error.message
      : 'compatible model configuration failed'
    throw new QwenTransportError(label, reason)
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0,
    timeout: REQUEST_TIMEOUT_MS,
  })
  const request = {
    model: config.model,
    max_tokens: 8192,
    messages: [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: userContent },
    ],
    tools: [{
      type: 'function' as const,
      function: {
        name: 'return_result',
        description: 'Return the structured analysis result',
        parameters: schema,
      },
    }],
    tool_choice: { type: 'function' as const, function: { name: 'return_result' } },
    ...(config.baseURL === OPENROUTER_COMPATIBLE_BASE_URL
      ? { reasoning: { enabled: false } }
      : { enable_thinking: false }),
  }

  const response = await requestWithBoundedRetry(
    () => client.chat.completions.create(request as never) as unknown as Promise<CompatibleCompletion>,
    label,
    runtime,
  )
  return parseForcedToolResult<T>(response, label)
}
