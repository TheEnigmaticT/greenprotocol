import { expect, it } from 'vitest'
import { AnthropicDecomposedProvider } from '@/lib/decomposed-benchmark/anthropic-provider'

it('uses a strict forced return tool and returns its structured input', async () => {
  let request: Record<string, unknown> | undefined
  const provider = new AnthropicDecomposedProvider({
    client: { messages: { create: async (value: Record<string, unknown>) => {
      request = value
      return { id: 'msg-1', content: [{ type: 'tool_use', name: 'return_decomposed_benchmark_result', input: { answer: 'ok' } }], usage: { input_tokens: 4, output_tokens: 6 } }
    } } } as never,
  })

  const result = await provider.completeJson<{ answer: string }>({ model: 'claude-sonnet-4-5-20250929', stage: 'segment', system: 'system', user: 'user', schema: { type: 'object' } })

  expect(request).toMatchObject({ model: 'claude-sonnet-4-5-20250929', tool_choice: { type: 'tool', name: 'return_decomposed_benchmark_result' } })
  expect(result).toMatchObject({ data: { answer: 'ok' }, provider: 'anthropic', generationId: 'msg-1', usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 } })
})
