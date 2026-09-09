import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  clientOptions: [] as unknown[],
}))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    constructor(options: unknown) {
      mocks.clientOptions.push(options)
    }

    chat = { completions: { create: mocks.create } }
  },
}))

import { QWEN_MODEL, QwenTransportError, callQwen } from '@/lib/qwen-adapter'

const schema = {
  type: 'object' as const,
  properties: { answer: { type: 'string' } },
  required: ['answer'],
}

const SUCCESS = {
  choices: [{
    finish_reason: 'tool_calls',
    message: {
      tool_calls: [{
        type: 'function',
        function: { name: 'return_result', arguments: '{"answer":"ok"}' },
      }],
    },
  }],
  usage: { prompt_tokens: 7, completion_tokens: 3 },
}

function request() {
  return { system: 'system unchanged', userContent: 'user unchanged', schema, label: 'parse' }
}

function providerError(status: number): Error & { status: number } {
  return Object.assign(new Error('provider error'), { status })
}

describe('Qwen OpenAI-compatible transport', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('OPENROUTER_API_KEY', 'legacy-test-key')
    vi.stubEnv('GCAI_ENGINE_CANDIDATE', '')
    vi.stubEnv('GCAI_LLM_BASE_URL', '')
    vi.stubEnv('GCAI_LLM_MODEL', '')
    vi.stubEnv('GCAI_LLM_API_KEY', '')
    mocks.create.mockReset()
    mocks.clientOptions.length = 0
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('preserves the GCAI_QWEN_PARITY OpenRouter route and native forced function', async () => {
    vi.stubEnv('GCAI_QWEN_PARITY', '1')
    mocks.create.mockResolvedValue(SUCCESS)

    const result = await callQwen<{ answer: string }>(request())

    expect(result.input).toEqual({ answer: 'ok' })
    expect(mocks.clientOptions[0]).toMatchObject({
      apiKey: 'legacy-test-key',
      baseURL: 'https://openrouter.ai/api/v1',
      maxRetries: 0,
      timeout: 120_000,
    })
    const wireRequest = mocks.create.mock.calls[0][0] as {
      model: string
      max_tokens: number
      messages: Array<{ role: string; content: string }>
      tools: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>
      tool_choice: unknown
      reasoning: unknown
    }
    expect(wireRequest).toMatchObject({
      model: QWEN_MODEL,
      max_tokens: 8192,
      messages: [
        { role: 'system', content: 'system unchanged' },
        { role: 'user', content: 'user unchanged' },
      ],
      tool_choice: { type: 'function', function: { name: 'return_result' } },
      reasoning: { enabled: false },
    })
    expect(wireRequest.tools).toHaveLength(1)
    expect(wireRequest.tools[0]).toMatchObject({
      type: 'function',
      function: {
        name: 'return_result',
        description: 'Return the structured analysis result',
      },
    })
    expect(wireRequest.tools[0].function.parameters).toBe(schema)
  })

  it('uses only the explicit candidate local endpoint, model, and key', async () => {
    vi.stubEnv('GCAI_ENGINE_CANDIDATE', '1')
    vi.stubEnv('GCAI_LLM_BASE_URL', 'http://127.0.0.1:8080/v1')
    vi.stubEnv('GCAI_LLM_MODEL', 'local/qwen-candidate')
    vi.stubEnv('GCAI_LLM_API_KEY', 'candidate-test-key')
    vi.stubEnv('OPENROUTER_API_KEY', 'must-not-be-selected')
    vi.stubEnv('ANTHROPIC_API_KEY', 'must-not-be-selected')
    vi.stubEnv('OPENAI_API_KEY', 'must-not-be-selected')
    mocks.create.mockResolvedValue(SUCCESS)

    await expect(callQwen<{ answer: string }>(request())).resolves.toMatchObject({ input: { answer: 'ok' } })

    expect(mocks.clientOptions).toEqual([expect.objectContaining({
      apiKey: 'candidate-test-key',
      baseURL: 'http://127.0.0.1:8080/v1',
    })])
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ model: 'local/qwen-candidate' })
  })

  it('allows OPENROUTER_API_KEY only for the exact explicitly selected OpenRouter v1 endpoint', async () => {
    vi.stubEnv('GCAI_ENGINE_CANDIDATE', '1')
    vi.stubEnv('GCAI_LLM_BASE_URL', 'https://openrouter.ai/api/v1')
    vi.stubEnv('GCAI_LLM_MODEL', QWEN_MODEL)
    vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-fallback-key')
    mocks.create.mockResolvedValue(SUCCESS)

    await callQwen(request())

    expect(mocks.clientOptions[0]).toMatchObject({
      apiKey: 'openrouter-fallback-key',
      baseURL: 'https://openrouter.ai/api/v1',
    })
  })

  it('fails configuration closed for a selected candidate missing a local key without attempting another provider', async () => {
    vi.stubEnv('GCAI_ENGINE_CANDIDATE', '1')
    vi.stubEnv('GCAI_LLM_BASE_URL', 'http://127.0.0.1:8080/v1')
    vi.stubEnv('GCAI_LLM_MODEL', 'local/qwen-candidate')
    vi.stubEnv('ANTHROPIC_API_KEY', 'must-not-be-selected')
    vi.stubEnv('OPENAI_API_KEY', 'must-not-be-selected')
    vi.stubEnv('OPENROUTER_API_KEY', 'must-not-be-selected')

    await expect(callQwen(request())).rejects.toEqual(expect.objectContaining({
      name: 'QwenTransportError',
      message: 'Qwen transport failed for parse: GCAI_LLM_API_KEY is required for the selected candidate endpoint',
    }))
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('fails configuration closed when a selected candidate omits endpoint or model', async () => {
    vi.stubEnv('GCAI_ENGINE_CANDIDATE', '1')
    vi.stubEnv('GCAI_LLM_API_KEY', 'candidate-test-key')
    vi.stubEnv('ANTHROPIC_API_KEY', 'must-not-be-selected')
    mocks.create.mockResolvedValue(SUCCESS)

    await expect(callQwen(request())).rejects.toEqual(expect.objectContaining({
      name: 'QwenTransportError',
      message: 'Qwen transport failed for parse: GCAI_LLM_BASE_URL is required when GCAI_ENGINE_CANDIDATE=1',
    }))
    expect(mocks.create).not.toHaveBeenCalled()

    vi.stubEnv('GCAI_LLM_BASE_URL', 'http://127.0.0.1:8080/v1')
    await expect(callQwen(request())).rejects.toEqual(expect.objectContaining({
      name: 'QwenTransportError',
      message: 'Qwen transport failed for parse: GCAI_LLM_MODEL is required when GCAI_ENGINE_CANDIDATE=1',
    }))
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('retries a transient callback error once at the same endpoint with bounded backoff', async () => {
    vi.stubEnv('GCAI_ENGINE_CANDIDATE', '1')
    vi.stubEnv('GCAI_LLM_BASE_URL', 'http://127.0.0.1:8080/v1')
    vi.stubEnv('GCAI_LLM_MODEL', 'local/qwen-candidate')
    vi.stubEnv('GCAI_LLM_API_KEY', 'candidate-test-key')
    mocks.create.mockRejectedValueOnce(providerError(429)).mockResolvedValueOnce(SUCCESS)
    const delays: number[] = []

    await expect(callQwen<{ answer: string }>(request(), {
      sleep: async (milliseconds: number) => { delays.push(milliseconds) },
      now: () => 0,
    })).resolves.toMatchObject({ input: { answer: 'ok' } })

    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.create.mock.calls[0][0]).toBe(mocks.create.mock.calls[1][0])
    expect(delays).toEqual([250])
    expect(mocks.clientOptions).toHaveLength(1)
  })

  it('retries an OpenRouter finish_reason error envelope and ignores its tool payload', async () => {
    mocks.create.mockResolvedValueOnce({
      choices: [{
        finish_reason: 'error',
        message: {
          tool_calls: [{ type: 'function', function: { name: 'return_result', arguments: '{"answer":"not trustworthy"}' } }],
        },
      }],
    }).mockResolvedValueOnce(SUCCESS)
    const delays: number[] = []

    await expect(callQwen<{ answer: string }>(request(), {
      sleep: async (milliseconds: number) => { delays.push(milliseconds) },
      now: () => 0,
    })).resolves.toMatchObject({ input: { answer: 'ok' } })

    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(delays).toEqual([250])
  })

  it('does not start a retry callback after the bounded deadline', async () => {
    mocks.create.mockRejectedValue(providerError(429))
    const sleep = vi.fn(async () => undefined)

    await expect(callQwen(request(), {
      deadlineMs: 100,
      now: () => 0,
      sleep,
    })).rejects.toEqual(expect.objectContaining({
      name: 'QwenTransportError',
      message: 'Qwen transport failed for parse: provider retry deadline exceeded',
    }))

    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('fails closed after bounded retries even when each errored response contains valid JSON', async () => {
    mocks.create.mockResolvedValue({
      choices: [{
        finish_reason: 'error',
        message: { tool_calls: [{ type: 'function', function: { name: 'return_result', arguments: '{"answer":"not trustworthy"}' } }] },
      }],
    })

    await expect(callQwen(request(), {
      sleep: async () => undefined,
      now: () => 0,
    })).rejects.toEqual(expect.objectContaining({
      name: 'QwenTransportError',
      message: 'Qwen transport failed for parse: provider unavailable after bounded retries',
    }))
    expect(mocks.create).toHaveBeenCalledTimes(3)
  })

  it('rejects truncated, malformed, and wrong-tool responses without treating them as successful tool output', async () => {
    mocks.create.mockResolvedValueOnce({
      choices: [{ finish_reason: 'length', message: { tool_calls: [] } }],
    })
    await expect(callQwen(request())).rejects.toEqual(expect.objectContaining({
      message: 'Qwen transport failed for parse: response truncated before return_result',
    }))

    mocks.create.mockResolvedValueOnce({
      choices: [{ finish_reason: 'tool_calls', message: {
        tool_calls: [{ type: 'function', function: { name: 'return_result', arguments: '{not json' } }],
      } }],
    })
    await expect(callQwen(request())).rejects.toEqual(expect.objectContaining({
      message: 'Qwen transport failed for parse: return_result arguments were not valid JSON',
    }))

    mocks.create.mockResolvedValueOnce({
      choices: [{ finish_reason: 'tool_calls', message: {
        tool_calls: [{ type: 'function', function: { name: 'some_other_tool', arguments: '{"answer":"wrong"}' } }],
      } }],
    })
    await expect(callQwen(request())).rejects.toEqual(expect.objectContaining({
      message: 'Qwen transport failed for parse: provider did not return return_result',
    }))
  })
})
