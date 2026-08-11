import OpenAI from 'openai'
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions'

export interface ChatProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
  allowedModels: string[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatStreamRequest {
  system: string
  messages: ChatMessage[]
  signal?: AbortSignal
}

export interface ChatStreamEvent {
  text: string
}

export interface ChatCompletionStreamChunk {
  choices: Array<{
    delta: {
      content?: string | null
    }
  }>
}

export interface ChatCompletionStreamRequest {
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  stream: true
  provider?: {
    data_collection: 'deny'
    zdr: true
    allow_fallbacks: false
  }
  reasoning?: {
    effort: 'minimal'
  }
}

export interface ChatCompletionStreamClient {
  chat: {
    completions: {
      create(
        request: ChatCompletionStreamRequest,
        options?: { signal?: AbortSignal },
      ): PromiseLike<AsyncIterable<ChatCompletionStreamChunk>>
    }
  }
}

export interface ChatProvider {
  stream(request: ChatStreamRequest): AsyncGenerator<ChatStreamEvent>
}

function requiredEnvironmentValue(environment: Record<string, string | undefined>, name: string): string {
  const value = environment[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

export function readChatProviderConfig(
  environment: Record<string, string | undefined> = process.env,
): ChatProviderConfig {
  const baseUrl = requiredEnvironmentValue(environment, 'CHAT_LLM_BASE_URL')
  const apiKey = requiredEnvironmentValue(environment, 'CHAT_LLM_API_KEY')
  const model = requiredEnvironmentValue(environment, 'CHAT_LLM_MODEL')
  const allowedModels = requiredEnvironmentValue(environment, 'CHAT_LLM_ALLOWED_MODELS')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

  if (!allowedModels.includes(model)) {
    throw new Error('CHAT_LLM_MODEL must be included in CHAT_LLM_ALLOWED_MODELS')
  }

  return { baseUrl, apiKey, model, allowedModels }
}

function createDefaultClient(config: ChatProviderConfig): ChatCompletionStreamClient {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  })

  return {
    chat: {
      completions: {
        create(request, options) {
          return client.chat.completions.create(
            request as unknown as ChatCompletionCreateParamsStreaming,
            options,
          ) as unknown as PromiseLike<AsyncIterable<ChatCompletionStreamChunk>>
        },
      },
    },
  }
}

export function createOpenAICompatibleChatProvider(
  config: ChatProviderConfig,
  client: ChatCompletionStreamClient = createDefaultClient(config),
): ChatProvider {
  if (!config.allowedModels.includes(config.model)) {
    throw new Error('Configured chat model is not allowlisted')
  }

  return {
    async *stream(request) {
      const completionRequest: ChatCompletionStreamRequest = {
        model: config.model,
        stream: true,
        messages: [
          { role: 'system', content: request.system },
          ...request.messages,
        ],
      }

      if (new URL(config.baseUrl).hostname === 'openrouter.ai') {
        completionRequest.provider = {
          data_collection: 'deny',
          zdr: true,
          allow_fallbacks: false,
        }
        completionRequest.reasoning = { effort: 'minimal' }
      }
      const response = request.signal
        ? await client.chat.completions.create(completionRequest, { signal: request.signal })
        : await client.chat.completions.create(completionRequest)

      for await (const chunk of response) {
        const text = chunk.choices[0]?.delta.content
        if (text) {
          yield { text }
        }
      }
    },
  }
}

export function createConfiguredChatProvider(): ChatProvider {
  const config = readChatProviderConfig()
  return createOpenAICompatibleChatProvider(config)
}
