/**
 * Fail-closed structured JSON over loopback Ollama for the GreenProtoCol pipeline.
 * When enabled, Anthropic must not be used for pipeline LLM stages.
 */
import { OLLAMA_PILOT_MODELS } from '@/lib/decomposed-benchmark/ollama-provider'

export const LOCAL_PIPELINE_MODELS = OLLAMA_PILOT_MODELS

export interface LocalPipelineEnv {
  GCAI_LOCAL_PIPELINE?: string
  GCAI_LOCAL_PARSE?: string
  GCAI_LOCAL_MODEL?: string
  GCAI_LOCAL_PARSE_MODEL?: string
}

export function isLocalPipelineEnabled(env: LocalPipelineEnv = process.env): boolean {
  return env.GCAI_LOCAL_PIPELINE === '1' || env.GCAI_LOCAL_PARSE === '1'
}

export function requireLocalPipelineModel(env: LocalPipelineEnv = process.env): string {
  const model = (env.GCAI_LOCAL_MODEL || env.GCAI_LOCAL_PARSE_MODEL || '').trim()
  if (!model || !(LOCAL_PIPELINE_MODELS as readonly string[]).includes(model)) {
    throw new Error('local_pipeline_configuration_invalid')
  }
  return model
}

export interface LocalJsonCompletionOptions {
  system: string
  user: string
  schema: Record<string, unknown>
  model?: string
  label?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  numPredict?: number
  env?: LocalPipelineEnv
}

/**
 * One bounded Ollama chat completion with JSON Schema `format`.
 * No redirects, proxies, retries, or cloud fallback.
 */
export async function completeLocalJson<T = unknown>(
  options: LocalJsonCompletionOptions,
): Promise<T> {
  const model = options.model ?? requireLocalPipelineModel(options.env ?? process.env)
  if (!(LOCAL_PIPELINE_MODELS as readonly string[]).includes(model)) {
    throw new Error('local_pipeline_configuration_invalid')
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 180_000
  const numPredict = options.numPredict ?? 4096
  const label = options.label ?? 'local-json'
  const started = Date.now()
  console.log(`[local-llm] ${label}: starting (model=${model})`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content: options.user },
        ],
        format: options.schema,
        stream: false,
        think: false,
        options: { temperature: 0, num_predict: numPredict, num_ctx: 32768 },
      }),
    })
    if (!response.ok) throw new Error('local_llm_http_failed')
    const data = await response.json() as {
      model?: string
      done?: boolean
      done_reason?: string
      message?: { role?: string; content?: string; tool_calls?: unknown }
    }
    if (
      data.model !== model
      || data.done !== true
      || data.done_reason !== 'stop'
      || data.message?.role !== 'assistant'
      || data.message?.tool_calls
      || typeof data.message?.content !== 'string'
      || !data.message.content.trim()
    ) {
      throw new Error('local_llm_response_invalid')
    }
    const parsed = JSON.parse(data.message.content) as T
    console.log(`[local-llm] ${label}: completed in ${((Date.now() - started) / 1000).toFixed(1)}s`)
    return parsed
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('local_llm_timeout')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
