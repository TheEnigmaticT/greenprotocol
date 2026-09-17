import type { BenchmarkProvider, JsonCompletion, JsonCompletionRequest } from './provider'
import { BenchmarkProviderError } from './provider'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

type ErrorCategory = 'configuration' | 'http' | 'network' | 'response' | 'invalid_json'

class OpenRouterOperationError extends Error {
  constructor(readonly category: ErrorCategory, readonly status?: number) {
    super()
  }
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function validateBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new OpenRouterOperationError('configuration')
  }

  const hostname = url.hostname.toLowerCase()
  const isOpenRouterHost = url.origin === 'https://openrouter.ai'
  const loopback = isLoopback(hostname)
  const validProtocol = url.protocol === 'https:' || (loopback && url.protocol === 'http:')
  const path = url.pathname.replace(/\/$/, '')
  if (!validProtocol || (!isOpenRouterHost && !loopback) || url.username || url.password || url.search || url.hash || path !== '/api/v1') {
    throw new OpenRouterOperationError('configuration')
  }
  return `${url.origin}/api/v1`
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface OpenRouterProviderOptions {
  apiKey: string
  fetch?: FetchLike
  baseUrl?: string
}

interface OpenRouterResponse {
  id?: string
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    cost?: number
  }
}

interface OpenRouterGenerationResponse {
  data?: { total_cost?: number; usage?: number }
}

export class OpenRouterProvider implements BenchmarkProvider {
  private readonly apiKey: string
  private readonly fetch: FetchLike
  private readonly baseUrl: string

  constructor(options: OpenRouterProviderOptions) {
    this.apiKey = options.apiKey
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  }

  async completeJson<T>(request: JsonCompletionRequest): Promise<JsonCompletion<T>> {
    try {
      const baseUrl = validateBaseUrl(this.baseUrl)
      let response: Response
      try {
        response = await this.fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'benchmark_result',
              strict: true,
              schema: request.schema,
            },
          },
          provider: { require_parameters: true, allow_fallbacks: false },
        }),
        })
      } catch {
        throw new OpenRouterOperationError('network')
      }

      if (!response.ok) {
        throw new OpenRouterOperationError('http', response.status)
      }

      let payload: OpenRouterResponse
      try {
        payload = await response.json() as OpenRouterResponse
      } catch {
        throw new OpenRouterOperationError('response')
      }
      const content = payload.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new OpenRouterOperationError('response')

      let data: T
      try {
        data = JSON.parse(content) as T
      } catch {
        throw new OpenRouterOperationError('invalid_json')
      }

      const usage = payload.usage ?? {}
      const inputTokens = usage.prompt_tokens
      const outputTokens = usage.completion_tokens
      const generationId = response.headers.get('x-generation-id') ?? payload.id ?? undefined
      let costUsd = typeof usage.cost === 'number' ? usage.cost : undefined
      if (costUsd === undefined && generationId) {
        try {
          const generationResponse = await this.fetch(`${baseUrl}/generation?id=${encodeURIComponent(generationId)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${this.apiKey}` },
          })
          if (generationResponse.ok) {
            const generation = await generationResponse.json() as OpenRouterGenerationResponse
            const fallbackCost = generation.data?.total_cost ?? generation.data?.usage
            if (typeof fallbackCost === 'number') costUsd = fallbackCost
          }
        } catch {
          // Generation metadata is optional; preserve unknown cost on failure.
        }
      }
      return {
        data,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: usage.total_tokens,
        },
        costUsd,
        generationId,
        provider: 'openrouter',
        model: request.model,
        stage: request.stage,
      }
    } catch (error) {
      if (error instanceof BenchmarkProviderError) throw error
      const operationError = error instanceof OpenRouterOperationError ? error : new OpenRouterOperationError('network')
      throw new BenchmarkProviderError(
        `OpenRouter ${operationError.category} error`,
        {
          provider: 'openrouter', model: request.model, stage: request.stage,
          category: operationError.category, status: operationError.status,
        },
      )
    }
  }
}
