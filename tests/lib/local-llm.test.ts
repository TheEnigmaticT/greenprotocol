import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_PIPELINE_MODELS,
  LOCAL_TOKEN_BUDGET_CAP,
  OPENROUTER_LOCAL_QUALITY_MODELS,
  completeLocalJson,
  completeLocalJsonResult,
  isLocalPipelineEnabled,
  isLocalReasoningBudgetEnabled,
  requireLocalPipelineModel,
  resolveLocalReasoningEffort,
  resolveLocalThink,
  resolveOllamaNumCtx,
  scaleLocalTokenBudget,
} from '@/lib/local-llm'

const MODEL = LOCAL_PIPELINE_MODELS[1]
const OR_MODEL = OPENROUTER_LOCAL_QUALITY_MODELS[0]

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('local pipeline config', () => {
  it('enables for exact pipeline or parse flags only', () => {
    expect(isLocalPipelineEnabled({ GCAI_LOCAL_PIPELINE: '1' })).toBe(true)
    expect(isLocalPipelineEnabled({ GCAI_LOCAL_PARSE: '1' })).toBe(true)
    expect(isLocalPipelineEnabled({ GCAI_LOCAL_PIPELINE: 'true' })).toBe(false)
  })

  it('accepts GCAI_LOCAL_MODEL or parse model alias', () => {
    expect(requireLocalPipelineModel({
      GCAI_LOCAL_PIPELINE: '1',
      GCAI_LOCAL_MODEL: MODEL,
    })).toBe(MODEL)
    expect(requireLocalPipelineModel({
      GCAI_LOCAL_PARSE: '1',
      GCAI_LOCAL_PARSE_MODEL: MODEL,
    })).toBe(MODEL)
    expect(() => requireLocalPipelineModel({
      GCAI_LOCAL_PIPELINE: '1',
      GCAI_LOCAL_MODEL: 'claude-sonnet-4-5-20250929',
    })).toThrow('local_pipeline_configuration_invalid')
  })
})

describe('resolveLocalReasoningEffort / think / budget', () => {
  it('defaults effort to medium when unset or invalid', () => {
    expect(resolveLocalReasoningEffort({})).toBe('medium')
    expect(resolveLocalReasoningEffort({ GCAI_LOCAL_REASONING_EFFORT: '' })).toBe('medium')
    expect(resolveLocalReasoningEffort({ GCAI_LOCAL_REASONING_EFFORT: 'nope' })).toBe('medium')
  })

  it('accepts explicit low | medium | high (case-insensitive)', () => {
    expect(resolveLocalReasoningEffort({ GCAI_LOCAL_REASONING_EFFORT: 'low' })).toBe('low')
    expect(resolveLocalReasoningEffort({ GCAI_LOCAL_REASONING_EFFORT: 'MEDIUM' })).toBe('medium')
    expect(resolveLocalReasoningEffort({ GCAI_LOCAL_REASONING_EFFORT: 'High' })).toBe('high')
  })

  it('defaults think to true; honors 0/1 overrides', () => {
    expect(resolveLocalThink({})).toBe(true)
    expect(resolveLocalThink({ GCAI_LOCAL_THINK: '1' })).toBe(true)
    expect(resolveLocalThink({ GCAI_LOCAL_THINK: '0' })).toBe(false)
    expect(resolveLocalThink({ GCAI_LOCAL_THINK: 'false' })).toBe(false)
  })

  it('scales token budget for medium/high and leaves base for low+think=0', () => {
    expect(scaleLocalTokenBudget(12288, { GCAI_LOCAL_REASONING_EFFORT: 'medium' })).toBe(18432)
    expect(scaleLocalTokenBudget(16384, { GCAI_LOCAL_REASONING_EFFORT: 'medium' })).toBe(24576)
    expect(scaleLocalTokenBudget(8192, { GCAI_LOCAL_REASONING_EFFORT: 'medium' })).toBe(12288)
    expect(scaleLocalTokenBudget(16384, { GCAI_LOCAL_REASONING_EFFORT: 'high' })).toBe(LOCAL_TOKEN_BUDGET_CAP)
    expect(scaleLocalTokenBudget(12288, {
      GCAI_LOCAL_REASONING_EFFORT: 'low',
      GCAI_LOCAL_THINK: '0',
    })).toBe(12288)
    expect(isLocalReasoningBudgetEnabled({
      GCAI_LOCAL_REASONING_EFFORT: 'low',
      GCAI_LOCAL_THINK: '0',
    })).toBe(false)
  })

  it('bumps Ollama num_ctx when predict exceeds 16k', () => {
    expect(resolveOllamaNumCtx(12288)).toBe(32768)
    expect(resolveOllamaNumCtx(18432)).toBe(65536)
  })
})

describe('completeLocalJson', () => {
  it('posts to loopback Ollama with schema format', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: MODEL,
      done: true,
      done_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify({ principleNumber: 5, recommendations: [] }) },
    }), { status: 200 }))

    const result = await completeLocalJson<{ principleNumber: number }>({
      system: 'sys',
      user: 'user',
      schema: { type: 'object' },
      model: MODEL,
      label: 'principle-5',
      env: { GCAI_LOCAL_PROVIDER: 'ollama', GCAI_LOCAL_MODEL: MODEL },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.principleNumber).toBe(5)
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/chat')
    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))
    expect(body.model).toBe(MODEL)
    expect(body.format).toEqual({ type: 'object' })
    expect(body.stream).toBe(false)
    expect(body.think).toBe(true)
    expect(body.options.num_predict).toBe(scaleLocalTokenBudget(4096, {}))
  })

  it('fails closed on identity mismatch without Anthropic fallback', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: 'wrong',
      done: true,
      done_reason: 'stop',
      message: { role: 'assistant', content: '{}' },
    }), { status: 200 }))
    await expect(completeLocalJson({
      system: 's', user: 'u', schema: { type: 'object' }, model: MODEL,
      env: { GCAI_LOCAL_PROVIDER: 'ollama', GCAI_LOCAL_MODEL: MODEL },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow('local_llm_response_invalid')
  })
})

describe('usage mapping + degraded flag', () => {
  it('posts Ollama with think=false and unscaled budget when env disables reasoning', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: MODEL,
      done: true,
      done_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify({ ok: true }) },
    }), { status: 200 }))

    await completeLocalJsonResult({
      system: 's',
      user: 'u',
      schema: { type: 'object' },
      model: MODEL,
      numPredict: 12288,
      env: {
        GCAI_LOCAL_PROVIDER: 'ollama',
        GCAI_LOCAL_MODEL: MODEL,
        GCAI_LOCAL_REASONING_EFFORT: 'low',
        GCAI_LOCAL_THINK: '0',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))
    expect(body.think).toBe(false)
    expect(body.options.num_predict).toBe(12288)
    expect(body.options.num_ctx).toBe(32768)
  })

  it('maps Ollama prompt_eval_count/eval_count into usage', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: MODEL,
      done: true,
      done_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify({ ok: true }) },
      prompt_eval_count: 120,
      eval_count: 45,
    }), { status: 200 }))

    const result = await completeLocalJsonResult<{ ok: boolean }>({
      system: 's',
      user: 'u',
      schema: { type: 'object' },
      model: MODEL,
      env: { GCAI_LOCAL_PROVIDER: 'ollama', GCAI_LOCAL_MODEL: MODEL },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.data).toEqual({ ok: true })
    expect(result.usage).toEqual({
      input_tokens: 120,
      output_tokens: 45,
      total_tokens: 165,
    })
    expect(result.degraded).toBeUndefined()
  })

  it('returns zero usage when Ollama omits eval counts', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: MODEL,
      done: true,
      done_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify({ ok: true }) },
    }), { status: 200 }))

    const result = await completeLocalJsonResult({
      system: 's',
      user: 'u',
      schema: { type: 'object' },
      model: MODEL,
      env: { GCAI_LOCAL_PROVIDER: 'ollama', GCAI_LOCAL_MODEL: MODEL },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    })
  })

  it('maps OpenRouter usage including reasoning_tokens', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      provider: 'TestProvider',
      choices: [{
        finish_reason: 'stop',
        message: { content: JSON.stringify({ principleNumber: 1, recommendations: [] }) },
      }],
      usage: {
        prompt_tokens: 200,
        completion_tokens: 80,
        total_tokens: 280,
        completion_tokens_details: { reasoning_tokens: 12 },
      },
    }), { status: 200 }))

    const result = await completeLocalJsonResult<{ principleNumber: number }>({
      system: 's',
      user: 'u',
      schema: { type: 'object' },
      model: OR_MODEL,
      env: {
        GCAI_LOCAL_PROVIDER: 'openrouter',
        GCAI_LOCAL_MODEL: OR_MODEL,
        OPENROUTER_API_KEY: 'test-key',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.data.principleNumber).toBe(1)
    expect(result.usage).toEqual({
      input_tokens: 200,
      output_tokens: 80,
      total_tokens: 280,
      reasoning_tokens: 12,
    })
    expect(result.degraded).toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))
    expect(body.reasoning).toEqual({ effort: 'medium' })
    expect(body.max_tokens).toBe(scaleLocalTokenBudget(8192, {}))
  })

  it('honors GCAI_LOCAL_REASONING_EFFORT=low without budget scale when think=0', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      provider: 'TestProvider',
      choices: [{
        finish_reason: 'stop',
        message: { content: JSON.stringify({ ok: true }) },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200 }))

    await completeLocalJsonResult({
      system: 's',
      user: 'u',
      schema: { type: 'object' },
      model: OR_MODEL,
      numPredict: 12288,
      env: {
        GCAI_LOCAL_PROVIDER: 'openrouter',
        GCAI_LOCAL_MODEL: OR_MODEL,
        OPENROUTER_API_KEY: 'test-key',
        GCAI_LOCAL_REASONING_EFFORT: 'low',
        GCAI_LOCAL_THINK: '0',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))
    expect(body.reasoning).toEqual({ effort: 'low' })
    expect(body.max_tokens).toBe(12288)
  })

  it('sets degraded=true after OpenRouter hollow-retry succeeds', async () => {
    const hollow = {
      provider: 'BadProvider',
      choices: [{ finish_reason: 'stop', message: { content: '' } }],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    }
    const recovered = {
      provider: 'FallbackProvider',
      choices: [{
        finish_reason: 'stop',
        message: { content: JSON.stringify({ principleNumber: 3, recommendations: [] }) },
      }],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 40,
        total_tokens: 55,
      },
    }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(hollow), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(recovered), { status: 200 }))

    const result = await completeLocalJsonResult<{ principleNumber: number }>({
      system: 's',
      user: 'u',
      schema: { type: 'object' },
      model: OR_MODEL,
      env: {
        GCAI_LOCAL_PROVIDER: 'openrouter',
        GCAI_LOCAL_MODEL: OR_MODEL,
        OPENROUTER_API_KEY: 'test-key',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))
    const secondBody = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body))
    expect(firstBody.response_format.type).toBe('json_schema')
    expect(secondBody.response_format.type).toBe('json_object')
    expect(result.degraded).toBe(true)
    expect(result.data.principleNumber).toBe(3)
    expect(result.usage).toEqual({
      input_tokens: 15,
      output_tokens: 40,
      total_tokens: 55,
    })
  })
})
