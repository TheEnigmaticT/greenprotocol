import { describe, expect, it, vi } from 'vitest'
import {
  createOpenAICompatibleChatProvider,
  readChatProviderConfig,
  type ChatCompletionStreamClient,
} from '@/lib/talk-about-this/chat-provider'

describe('readChatProviderConfig', () => {
  it('fails closed when the open-model endpoint is not configured', () => {
    expect(() => readChatProviderConfig({
      CHAT_LLM_MODEL: 'Qwen/Qwen3-32B',
      CHAT_LLM_ALLOWED_MODELS: 'Qwen/Qwen3-32B',
    })).toThrow('CHAT_LLM_BASE_URL is required')
  })

  it('rejects a configured model outside the allowlist', () => {
    expect(() => readChatProviderConfig({
      CHAT_LLM_BASE_URL: 'https://models.internal/v1',
      CHAT_LLM_API_KEY: 'test-key',
      CHAT_LLM_MODEL: 'claude-sonnet-4-5-20250929',
      CHAT_LLM_ALLOWED_MODELS: 'Qwen/Qwen3-32B',
    })).toThrow('CHAT_LLM_MODEL must be included in CHAT_LLM_ALLOWED_MODELS')
  })
})

describe('createOpenAICompatibleChatProvider', () => {
  it('streams only text deltas through the configured allowlisted model', async () => {
    const create = vi.fn().mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'The score ' } }] }
      yield { choices: [{ delta: { content: 'is calculated.' } }] }
      yield { choices: [{ delta: { tool_calls: [{ id: 'ignored' }] } }] }
    })())
    const client: ChatCompletionStreamClient = {
      chat: { completions: { create } },
    }
    const provider = createOpenAICompatibleChatProvider({
      baseUrl: 'https://models.internal/v1',
      apiKey: 'test-key',
      model: 'Qwen/Qwen3-32B',
      allowedModels: ['Qwen/Qwen3-32B'],
    }, client)

    const deltas: string[] = []
    for await (const event of provider.stream({
      system: 'Use only supplied evidence.',
      messages: [{ role: 'user', content: 'Why was this recommendation made?' }],
    })) {
      deltas.push(event.text)
    }

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
})

  it('enforces privacy routing and minimal reasoning for OpenRouter Qwen 3.8', async () => {
    const create = vi.fn().mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'Scoped response.' } }] }
    })())
    const provider = createOpenAICompatibleChatProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'test-key',
      model: 'qwen/qwen3.8-max',
      allowedModels: ['qwen/qwen3.8-max'],
    }, { chat: { completions: { create } } })

    for await (const _event of provider.stream({
      system: 'Use only supplied evidence.',
      messages: [{ role: 'user', content: 'Why was this recommendation made?' }],
    })) {
      // Drain the stream to inspect the provider request.
    }

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'qwen/qwen3.8-max',
      provider: {
        data_collection: 'deny',
        zdr: true,
        allow_fallbacks: false,
      },
      max_tokens: 1024,
      reasoning: { effort: 'minimal' },
    }))
  })
