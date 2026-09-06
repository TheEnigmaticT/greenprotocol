import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_PIPELINE_MODELS,
  completeLocalJson,
  isLocalPipelineEnabled,
  requireLocalPipelineModel,
} from '@/lib/local-llm'

const MODEL = LOCAL_PIPELINE_MODELS[1]

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
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.principleNumber).toBe(5)
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/chat')
    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))
    expect(body.model).toBe(MODEL)
    expect(body.format).toEqual({ type: 'object' })
    expect(body.stream).toBe(false)
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
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow('local_llm_response_invalid')
  })
})
