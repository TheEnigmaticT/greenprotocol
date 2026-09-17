import { describe, expect, it, vi } from 'vitest'
import { AnthropicProvider } from '@/lib/benchmark/anthropic-provider'
import { OpenRouterProvider } from '@/lib/benchmark/openrouter-provider'
import { BenchmarkProviderError, type JsonCompletionRequest } from '@/lib/benchmark/provider'

const request: JsonCompletionRequest = {
  model: 'literal/model-id',
  stage: 'parse',
  system: 'Return the requested object.',
  user: 'Analyze this protocol.',
  schema: {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
  },
}

describe('AnthropicProvider', () => {
  it('forces the return_result tool and normalizes usage', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'msg_123',
      content: [{ type: 'tool_use', name: 'return_result', input: { answer: 'ok' } }],
      usage: { input_tokens: 11, output_tokens: 7 },
      stop_reason: 'tool_use',
    })
    const provider = new AnthropicProvider({ client: { messages: { create } } as never })

    const result = await provider.completeJson(request)

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: request.model,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
      tool_choice: { type: 'tool', name: 'return_result' },
      tools: [{
        name: 'return_result',
        description: expect.any(String),
        strict: true,
        input_schema: request.schema,
      }],
    }))
    expect(result.data).toEqual({ answer: 'ok' })
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7, totalTokens: 18 })
    expect(result.provider).toBe('anthropic')
    expect(result.model).toBe(request.model)
    expect(result.stage).toBe('parse')
    expect(result.generationId).toBe('msg_123')
  })

  it('rejects a tool_use block whose name is not return_result', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'msg_wrong_tool',
      content: [{ type: 'tool_use', name: 'other_tool', input: { answer: 'wrong' } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const provider = new AnthropicProvider({ client: { messages: { create } } as never })

    const error = await provider.completeJson(request).catch((error: unknown) => error as BenchmarkProviderError)

    expect(error).toBeInstanceOf(BenchmarkProviderError)
    expect(error).toMatchObject({ provider: 'anthropic', model: request.model, stage: 'parse' })
  })

  it('sanitizes provider failures without retaining the original error', async () => {
    const create = vi.fn().mockRejectedValue(new Error('secret response body with test-key and request details'))
    const provider = new AnthropicProvider({ client: { messages: { create } } as never })

    const error = await provider.completeJson({ ...request, stage: 'transport' }).catch((error: unknown) => error as BenchmarkProviderError) as BenchmarkProviderError

    expect(error).toBeInstanceOf(BenchmarkProviderError)
    expect(error).toMatchObject({
      provider: 'anthropic', model: request.model, stage: 'transport', category: 'provider',
    })
    expect(error.message).not.toContain('secret response body')
    expect(error.message).not.toContain('test-key')
    expect(error.message).not.toContain(request.user)
    expect(error.cause).toBeUndefined()
  })

  it('re-sanitizes provider errors supplied by the client', async () => {
    const create = vi.fn().mockRejectedValue(new BenchmarkProviderError(
      'raw client failure with test-key',
      { provider: 'client', model: request.model, stage: request.stage, category: 'raw' },
    ))
    const provider = new AnthropicProvider({ client: { messages: { create } } as never })

    const error = await provider.completeJson(request).catch((error: unknown) => error as BenchmarkProviderError) as BenchmarkProviderError

    expect(error).toBeInstanceOf(BenchmarkProviderError)
    expect(error).toMatchObject({
      provider: 'anthropic', model: request.model, stage: request.stage, category: 'provider',
    })
    expect(error.message).not.toContain('raw client failure')
    expect(error.message).not.toContain('test-key')
    expect(error.cause).toBeUndefined()
  })
})

describe('OpenRouterProvider', () => {
  it('preserves the literal model ID, requests JSON, and disables fallback routing', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'gen_123',
      model: request.model,
      choices: [{ message: { content: '{"answer":"ok"}' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, cost: 0.0042 },
    }), { status: 200, headers: { 'x-generation-id': 'gen_header' } }))
    const provider = new OpenRouterProvider({ apiKey: 'test-key', fetch })

    const result = await provider.completeJson(request)

    const [, init] = fetch.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.model).toBe(request.model)
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'benchmark_result', strict: true, schema: request.schema },
    })
    expect(body.provider).toEqual({ require_parameters: true, allow_fallbacks: false })
    expect(result.data).toEqual({ answer: 'ok' })
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 3, totalTokens: 8 })
    expect(result.costUsd).toBe(0.0042)
    expect(result.generationId).toBe('gen_header')
  })

  it('reports malformed JSON with provider, model, and stage metadata', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'gen_bad',
      choices: [{ message: { content: '{not-json' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200 }))
    const provider = new OpenRouterProvider({ apiKey: 'test-key', fetch })

    const error = await provider.completeJson({ ...request, stage: 'assemble' }).catch((error: unknown) => error as BenchmarkProviderError)

    expect(error).toBeInstanceOf(BenchmarkProviderError)
    expect(error).toMatchObject({ provider: 'openrouter', model: request.model, stage: 'assemble' })
  })

  it('leaves cost unknown when generation cost is absent', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'gen_no_cost',
      choices: [{ message: { content: '{"answer":"ok"}' } }],
      usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { total_cost: 0.0075 } }), { status: 200 }))
    const provider = new OpenRouterProvider({ apiKey: 'test-key', fetch })

    const result = await provider.completeJson(request)

    expect(result.costUsd).toBe(0.0075)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toBe('https://openrouter.ai/api/v1/generation?id=gen_no_cost')
    expect(fetch.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer test-key' })
  })

  it('preserves unknown token fields and total when OpenRouter omits them', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'gen_unknown_usage',
      choices: [{ message: { content: '{"answer":"ok"}' } }],
      usage: { prompt_tokens: 2 },
    }), { status: 200 }))
    const provider = new OpenRouterProvider({ apiKey: 'test-key', fetch })

    const result = await provider.completeJson(request)

    expect(result.usage).toEqual({ inputTokens: 2, outputTokens: undefined, totalTokens: undefined })
  })

  it('uses generation usage as a cost fallback', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'gen_usage_cost',
        choices: [{ message: { content: '{"answer":"ok"}' } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { usage: 0.009 } }), { status: 200 }))
    const provider = new OpenRouterProvider({ apiKey: 'test-key', fetch })

    const result = await provider.completeJson(request)

    expect(result.costUsd).toBe(0.009)
  })

  it('preserves unknown cost when generation lookup fails', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'gen_lookup_failed',
        choices: [{ message: { content: '{"answer":"ok"}' } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    const provider = new OpenRouterProvider({ apiKey: 'test-key', fetch })

    const result = await provider.completeJson(request)

    expect(result.costUsd).toBeUndefined()
  })

  it('does not look up generation cost when completion cost is present', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'gen_present_cost',
      choices: [{ message: { content: '{"answer":"ok"}' } }],
      usage: { cost: 0.004 },
    }), { status: 200 }))
    const provider = new OpenRouterProvider({ apiKey: 'test-key', fetch })

    const result = await provider.completeJson(request)

    expect(result.costUsd).toBe(0.004)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('sanitizes HTTP response errors and drops the raw response as a cause', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(
      'secret response body with Bearer test-key and protocol details',
      { status: 502, headers: { 'x-provider-debug': 'sensitive header' } },
    ))
    const provider = new OpenRouterProvider({ apiKey: 'test-key', fetch })

    const error = await provider.completeJson(request).catch((error: unknown) => error as BenchmarkProviderError) as BenchmarkProviderError

    expect(error).toBeInstanceOf(BenchmarkProviderError)
    expect(error).toMatchObject({
      provider: 'openrouter', model: request.model, stage: request.stage,
      category: 'http', status: 502,
    })
    expect(error.message).not.toContain('secret response body')
    expect(error.message).not.toContain('test-key')
    expect(error.cause).toBeUndefined()
  })

  it('sanitizes transport errors without retaining the original error', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('socket failed with test-key and headers'))
    const provider = new OpenRouterProvider({ apiKey: 'test-key', fetch })

    const error = await provider.completeJson({ ...request, stage: 'transport' }).catch((error: unknown) => error as BenchmarkProviderError) as BenchmarkProviderError

    expect(error).toMatchObject({
      provider: 'openrouter', model: request.model, stage: 'transport',
      category: 'network', status: undefined,
    })
    expect(error.message).not.toContain('socket failed')
    expect(error.message).not.toContain('test-key')
    expect(error.cause).toBeUndefined()
  })

  it.each([
    'http://openrouter.ai/api/v1',
    'https://evil.openrouter.ai/api/v1',
    'https://evil.example/api/v1',
    'https://user:password@openrouter.ai/api/v1',
    'https://openrouter.ai/not-api-v1',
  ])('rejects unsafe base URL %s before sending credentials', async baseUrl => {
    const fetch = vi.fn()
    const provider = new OpenRouterProvider({ apiKey: 'test-key', fetch, baseUrl })

    const error = await provider.completeJson({ ...request, stage: 'config' }).catch((error: unknown) => error as BenchmarkProviderError) as BenchmarkProviderError

    expect(error).toBeInstanceOf(BenchmarkProviderError)
    expect(error).toMatchObject({
      provider: 'openrouter', model: request.model, stage: 'config',
      category: 'configuration', status: undefined,
    })
    expect(error.message).not.toContain(baseUrl)
    expect(error.message).not.toContain('test-key')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('allows an explicit loopback HTTP base URL for tests', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"answer":"ok"}' } }],
    }), { status: 200 }))
    const provider = new OpenRouterProvider({
      apiKey: 'test-key', fetch, baseUrl: 'http://127.0.0.1:8787/api/v1/',
    })

    await provider.completeJson(request)

    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:8787/api/v1/chat/completions')
  })
})
