import Anthropic from '@anthropic-ai/sdk'
import type { DecomposedBenchmarkProvider, JsonCompletion, JsonCompletionRequest } from './provider'

const TOOL_NAME = 'return_decomposed_benchmark_result'

type AnthropicClient = Pick<Anthropic, 'messages'>

export class AnthropicDecomposedProvider implements DecomposedBenchmarkProvider {
  private readonly client: AnthropicClient

  constructor(options: { client?: AnthropicClient } = {}) {
    this.client = options.client ?? new Anthropic()
  }

  async completeJson<T>(request: JsonCompletionRequest): Promise<JsonCompletion<T>> {
    try {
      const response = await this.client.messages.create({
        model: request.model,
        max_tokens: 8192,
        system: request.system,
        tools: [{ name: TOOL_NAME, description: 'Return the requested benchmark result.', strict: true, input_schema: request.schema as Anthropic.Messages.Tool['input_schema'] }],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: request.user }],
      })
      const toolUse = response.content.find(block => block.type === 'tool_use' && block.name === TOOL_NAME)
      if (!toolUse || toolUse.type !== 'tool_use') throw new Error('Anthropic response did not contain the required result tool')
      return {
        data: toolUse.input as T,
        provider: 'anthropic',
        model: request.model,
        stage: request.stage,
        generationId: response.id,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, totalTokens: response.usage.input_tokens + response.usage.output_tokens },
      }
    } catch {
      throw new Error('Anthropic request failed')
    }
  }
}
