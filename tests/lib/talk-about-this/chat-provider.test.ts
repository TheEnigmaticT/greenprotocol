import { describe, expect, it, vi } from 'vitest'
import {
  createOpenAICompatibleChatProvider,
  readChatProviderConfig,
  type ChatCompletionStreamClient,
} from '@/lib/talk-about-this/chat-provider'

const openRouterConfig = {
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'test-key',
  model: 'qwen/qwen3.6-35b-a3b',
  allowedModels: ['qwen/qwen3.6-35b-a3b'],
  allowedBaseUrls: ['https://openrouter.ai/api/v1'],
}

describe('readChatProviderConfig', () => {
  it('fails closed when the open-model endpoint is not configured', () => {
    expect(() => readChatProviderConfig({
      CHAT_LLM_API_KEY: 'test-key',
      CHAT_LLM_MODEL: 'Qwen/Qwen3-32B',
      CHAT_LLM_ALLOWED_MODELS: 'Qwen/Qwen3-32B',
      CHAT_LLM_ALLOWED_BASE_URLS: 'https://openrouter.ai/api/v1',
    })).toThrow('CHAT_LLM_BASE_URL is required')
  })

  it('rejects a configured model outside the allowlist', () => {
    expect(() => readChatProviderConfig({
      CHAT_LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      CHAT_LLM_API_KEY: 'test-key',
      CHAT_LLM_MODEL: 'claude-sonnet-4-5-20250929',
      CHAT_LLM_ALLOWED_MODELS: 'Qwen/Qwen3-32B',
      CHAT_LLM_ALLOWED_BASE_URLS: 'https://openrouter.ai/api/v1',
    })).toThrow('CHAT_LLM_MODEL must be included in CHAT_LLM_ALLOWED_MODELS')
  })

  it('rejects a configured endpoint outside the approved base-url allowlist', () => {
    expect(() => readChatProviderConfig({
      CHAT_LLM_BASE_URL: 'https://unapproved.example/v1',
      CHAT_LLM_API_KEY: 'test-key',
      CHAT_LLM_MODEL: 'Qwen/Qwen3-32B',
      CHAT_LLM_ALLOWED_MODELS: 'Qwen/Qwen3-32B',
      CHAT_LLM_ALLOWED_BASE_URLS: 'https://openrouter.ai/api/v1',
    })).toThrow('CHAT_LLM_BASE_URL must be included in CHAT_LLM_ALLOWED_BASE_URLS')
  })
})

describe('createOpenAICompatibleChatProvider', () => {
  it('streams only text deltas through the configured allowlisted model', async () => {
    const create = vi.fn().mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'The score ' } }] }
      yield { choices: [{ delta: { content: 'is calculated.' } }] }
      yield { choices: [{ delta: { tool_calls: [{ id: 'ignored' }] } }] }
    })())
    const client: ChatCompletionStreamClient = { chat: { completions: { create } } }
    const provider = createOpenAICompatibleChatProvider({
      baseUrl: 'http://127.0.0.1:8000/v1',
      apiKey: 'test-key',
      model: 'Qwen/Qwen3-32B',
      allowedModels: ['Qwen/Qwen3-32B'],
      allowedBaseUrls: ['http://127.0.0.1:8000/v1'],
    }, client)

    const deltas: Array<string | undefined> = []
    for await (const event of provider.stream({
      system: 'Use only supplied evidence.',
      messages: [{ role: 'user', content: 'Why was this recommendation made?' }],
    })) deltas.push(event.text)

    expect(deltas).toEqual(['The score ', 'is calculated.'])
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'Qwen/Qwen3-32B',
      stream: true,
      messages: [
        { role: 'system', content: 'Use only supplied evidence.' },
        { role: 'user', content: 'Why was this recommendation made?' },
      ],
    }))
  })

  it('enforces privacy routing and minimal reasoning for OpenRouter Qwen', async () => {
    const create = vi.fn().mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'Scoped response.' } }] }
    })())
    const provider = createOpenAICompatibleChatProvider(openRouterConfig, { chat: { completions: { create } } })

    for await (const _event of provider.stream({
      system: 'Use only supplied evidence.',
      messages: [{ role: 'user', content: 'Why was this recommendation made?' }],
    })) {}

    expect(create.mock.calls[0][0]).toMatchObject({
      model: 'qwen/qwen3.6-35b-a3b',
      provider: { data_collection: 'deny', zdr: true, allow_fallbacks: false },
      reasoning: { effort: 'minimal' },
    })
  })

  it('passes scoped function schemas to a tool-capable completion request', async () => {
    const create = vi.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'Grounded answer.' } }] }
      },
    })
    const provider = createOpenAICompatibleChatProvider(openRouterConfig, { chat: { completions: { create } } })

    for await (const _event of provider.stream({
      system: 'Use supplied evidence.',
      messages: [{ role: 'user', content: 'What does CHEM21 say about DMF?' }],
      tools: [{
        type: 'function',
        function: {
          name: 'lookup_chem21_solvent',
          description: 'Look up CHEM21 data.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: { chemical: { type: 'string', enum: ['DMF'] } },
            required: ['chemical'],
          },
        },
      }],
    })) {}

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      tools: expect.arrayContaining([expect.objectContaining({
        function: expect.objectContaining({ name: 'lookup_chem21_solvent' }),
      })]),
      tool_choice: 'auto',
    }))
  })
})
