import type { DecomposedBenchmarkProvider, JsonCompletion, JsonCompletionRequest } from './provider'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface OpenRouterResponse {
  id?: string
  choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { arguments?: string } }> } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number }
}

export class OpenRouterDecomposedProvider implements DecomposedBenchmarkProvider {
  private readonly apiKey: string
  private readonly fetch: FetchLike
  private readonly baseUrl: string

  constructor(options: { apiKey: string; fetch?: FetchLike; baseUrl?: string }) {
    if (!options.apiKey.trim()) throw new Error('OpenRouter API key is required')
    this.apiKey = options.apiKey
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.baseUrl = options.baseUrl ?? 'https://openrouter.ai/api/v1'
  }

  async completeJson<T>(request: JsonCompletionRequest): Promise<JsonCompletion<T>> {
    let response: Response
    try {
      response = await this.fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          max_tokens: 4096,
          messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
          tools: [{ type: 'function', function: { name: 'return_decomposed_benchmark_result', description: 'Return the requested benchmark result as structured data.', parameters: request.schema } }],
          tool_choice: { type: 'function', function: { name: 'return_decomposed_benchmark_result' } },
          provider: { require_parameters: true, allow_fallbacks: false },
        }),
      })
    } catch {
      throw new Error('OpenRouter request failed (network)')
    }
    if (!response.ok) throw new Error(`OpenRouter request failed (HTTP ${response.status})`)

    let payload: OpenRouterResponse
    try {
      payload = await response.json() as OpenRouterResponse
    } catch {
      throw new Error('OpenRouter request failed (invalid response)')
    }
    const argumentsText = payload.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
    if (typeof argumentsText !== 'string') throw new Error('OpenRouter request failed (missing structured tool result)')
    let data: T
    try {
      data = JSON.parse(argumentsText) as T
    } catch {
      throw new Error('OpenRouter request failed (invalid structured JSON)')
    }
    const usage = payload.usage ?? {}
    return {
      data,
      provider: 'openrouter',
      model: request.model,
      stage: request.stage,
      generationId: payload.id,
      costUsd: typeof usage.cost === 'number' ? usage.cost : undefined,
      usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, totalTokens: usage.total_tokens },
    }
  }
}
