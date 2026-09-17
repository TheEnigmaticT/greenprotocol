import Anthropic from '@anthropic-ai/sdk'
import type { BenchmarkProvider, JsonCompletionRequest, JsonCompletion } from './provider'
import { BenchmarkProviderError } from './provider'

const TOOL_NAME = 'return_result'

type AnthropicClient = Pick<Anthropic, 'messages'>

export interface AnthropicProviderOptions {
  client?: AnthropicClient
  maxTokens?: number
}

export class AnthropicProvider implements BenchmarkProvider {
  private readonly client: AnthropicClient
  private readonly maxTokens: number

  constructor(options: AnthropicProviderOptions = {}) {
    this.client = options.client ?? new Anthropic()
    this.maxTokens = options.maxTokens ?? 8192
  }

  async completeJson<T>(request: JsonCompletionRequest): Promise<JsonCompletion<T>> {
    try {
      const response = await this.client.messages.create({
        model: request.model,
        max_tokens: this.maxTokens,
        system: request.system,
        tools: [{
          name: TOOL_NAME,
          description: 'Return the requested benchmark result as structured data.',
          strict: true,
          input_schema: request.schema as Anthropic.Messages.Tool['input_schema'],
        }],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: request.user }],
      })

      const toolUse = response.content.find(block => block.type === 'tool_use' && block.name === TOOL_NAME)
      if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error(`Anthropic did not return a ${TOOL_NAME} tool result`)
      }

      const inputTokens = response.usage.input_tokens
      const outputTokens = response.usage.output_tokens
      return {
        data: toolUse.input as T,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        provider: 'anthropic',
        model: request.model,
        stage: request.stage,
        generationId: response.id,
      }
    } catch {
      throw new BenchmarkProviderError(
        'Anthropic provider error',
        { provider: 'anthropic', model: request.model, stage: request.stage, category: 'provider' },
      )
    }
  }
}
