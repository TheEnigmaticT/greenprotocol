import { describe, expect, it } from 'vitest'
import { OpenRouterDecomposedProvider } from '@/lib/decomposed-benchmark/openrouter-provider'

describe('OpenRouterDecomposedProvider', () => {
  it('uses a forced function return and preserves provider-reported telemetry', async () => {
    let request: RequestInit | undefined
    const provider = new OpenRouterDecomposedProvider({
      apiKey: 'test-key',
      fetch: async (_url: string | URL | Request, init?: RequestInit) => {
        request = init
        return new Response(JSON.stringify({ id: 'gen-1', choices: [{ message: { tool_calls: [{ function: { arguments: '{"answer":"ok"}' } }] } }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, cost: 0.001 } }), { status: 200 })
      },
    })

    const result = await provider.completeJson<{ answer: string }>({ model: 'google/gemma-4-31b-it', stage: 'segment', system: 'system', user: 'user', schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } })

    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: 'google/gemma-4-31b-it',
      max_tokens: 4096,
      tools: [{ type: 'function', function: { name: 'return_decomposed_benchmark_result' } }],
      tool_choice: { type: 'function', function: { name: 'return_decomposed_benchmark_result' } },
      provider: { require_parameters: true, allow_fallbacks: false },
    })
    expect(result).toMatchObject({ data: { answer: 'ok' }, provider: 'openrouter', stage: 'segment', generationId: 'gen-1', costUsd: 0.001, usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } })
  })

  it('rejects an HTTP error without exposing response content', async () => {
    const provider = new OpenRouterDecomposedProvider({ apiKey: 'test-key', fetch: async () => new Response('secret upstream body', { status: 429 }) })
    await expect(provider.completeJson({ model: 'google/gemma-4-31b-it', stage: 'segment', system: 'system', user: 'user', schema: {} })).rejects.toThrow('OpenRouter request failed (HTTP 429)')
  })
})
