import OpenAI from 'openai'
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions'
import type { ChatToolDefinition } from '@/lib/talk-about-this/tools'

export interface ChatProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
  allowedModels: string[]
  allowedBaseUrls: string[]
}

export type ChatMessage =
  | { role: 'user' | 'assistant'; content: string; toolCalls?: never }
  | { role: 'assistant'; content: string; toolCalls: ChatToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string }

export interface ChatStreamRequest {
  system: string
  messages: ChatMessage[]
  tools?: ChatToolDefinition[]
  signal?: AbortSignal
}

export interface ChatToolCall {
  id: string
  name: string
  arguments: string
}

export interface ChatStreamEvent {
  text?: string
  toolCalls?: ChatToolCall[]
}

export interface ChatCompletionStreamChunk {
  choices: Array<{
    delta: {
      content?: string | null
      tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
    }
  }>
}

export type ChatCompletionMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string; tool_calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; content: string; tool_call_id: string }

export interface ChatCompletionStreamRequest {
  model: string
  messages: ChatCompletionMessage[]
  stream: true
  max_tokens: number
  tools?: ChatToolDefinition[]
  tool_choice?: 'auto'
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

function normalizeBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('CHAT_LLM_BASE_URL must use HTTP or HTTPS')
  }
  if (url.username || url.password) {
    throw new Error('CHAT_LLM_BASE_URL must not contain credentials')
  }
  return url.toString().replace(/\/$/, '')
}

function isLoopbackEndpoint(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function assertApprovedBaseUrl(baseUrl: string, allowedBaseUrls: string[]) {
  if (!allowedBaseUrls.includes(baseUrl)) {
    throw new Error('CHAT_LLM_BASE_URL must be included in CHAT_LLM_ALLOWED_BASE_URLS')
  }
  if (!isLoopbackEndpoint(baseUrl) && new URL(baseUrl).hostname !== 'openrouter.ai') {
    throw new Error('CHAT_LLM_BASE_URL must be a loopback endpoint or OpenRouter')
  }
}

export function readChatProviderConfig(
  environment: Record<string, string | undefined> = process.env,
): ChatProviderConfig {
  const baseUrl = normalizeBaseUrl(requiredEnvironmentValue(environment, 'CHAT_LLM_BASE_URL'))
  const apiKey = requiredEnvironmentValue(environment, 'CHAT_LLM_API_KEY')
  const model = requiredEnvironmentValue(environment, 'CHAT_LLM_MODEL')
  const allowedModels = requiredEnvironmentValue(environment, 'CHAT_LLM_ALLOWED_MODELS')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const allowedBaseUrls = requiredEnvironmentValue(environment, 'CHAT_LLM_ALLOWED_BASE_URLS')
    .split(',')
    .map(value => normalizeBaseUrl(value.trim()))
    .filter(Boolean)

  if (!allowedModels.includes(model)) {
    throw new Error('CHAT_LLM_MODEL must be included in CHAT_LLM_ALLOWED_MODELS')
  }
  assertApprovedBaseUrl(baseUrl, allowedBaseUrls)

  return { baseUrl, apiKey, model, allowedModels, allowedBaseUrls }
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
  assertApprovedBaseUrl(normalizeBaseUrl(config.baseUrl), config.allowedBaseUrls.map(normalizeBaseUrl))

  return {
    async *stream(request) {
      const completionRequest: ChatCompletionStreamRequest = {
        model: config.model,
        stream: true,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: request.system },
          ...request.messages.map(message => {
            if (message.role === 'tool') {
              return { role: 'tool' as const, content: message.content, tool_call_id: message.toolCallId }
            }
            if (message.toolCalls) {
              return {
                role: 'assistant' as const,
                content: message.content,
                tool_calls: message.toolCalls.map(call => ({
                  id: call.id,
                  type: 'function' as const,
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            }
            return { role: message.role, content: message.content }
          }),
        ],
      }
      if (request.tools?.length) {
        completionRequest.tools = request.tools
        completionRequest.tool_choice = 'auto'
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

      const calls = new Map<number, ChatToolCall>()
      for await (const chunk of response) {
        const delta = chunk.choices[0]?.delta
        if (delta?.content) yield { text: delta.content }
        for (const partial of delta?.tool_calls || []) {
          const current = calls.get(partial.index) || { id: '', name: '', arguments: '' }
          calls.set(partial.index, {
            id: partial.id || current.id,
            name: partial.function?.name || current.name,
            arguments: current.arguments + (partial.function?.arguments || ''),
          })
        }
      }
      const toolCalls = [...calls.values()].filter(call => call.id && call.name)
      if (toolCalls.length) yield { toolCalls }
    },
  }
}

export function createConfiguredChatProvider(): ChatProvider {
  const config = readChatProviderConfig()
  return createOpenAICompatibleChatProvider(config)
}
