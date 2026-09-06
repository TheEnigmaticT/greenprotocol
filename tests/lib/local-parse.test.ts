import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_PARSE_MODELS,
  adaptStepsForLocalHelpers,
  flattenChemicalsForScore,
  isLocalParseEnabled,
  mapParseRole,
  parseProtocolLocal,
  requireLocalParseModel,
  validateLocalParseResult,
} from '@/lib/local-parse'

const MODEL = LOCAL_PARSE_MODELS[1]
const TEXT = 'Add ethanol (5 mL). Monitor by TLC.'

function okPayload(overrides: Record<string, unknown> = {}) {
  return {
    protocolTitle: 'Ethanol addition',
    chemistrySubdomain: 'Organic Synthesis',
    steps: [{
      stepNumber: 1,
      description: TEXT,
      chemicals: [{ name: 'ethanol', role: 'solvent', quantity: '5 mL' }],
      conditions: {},
    }],
    ...overrides,
  }
}

function mockOllama(content: unknown, model = MODEL) {
  return vi.fn(async () => new Response(JSON.stringify({
    model,
    done: true,
    done_reason: 'stop',
    message: { role: 'assistant', content: JSON.stringify(content) },
  }), { status: 200 }))
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('local parse config', () => {
  it('is opt-in only for exact GCAI_LOCAL_PARSE=1', () => {
    expect(isLocalParseEnabled({ GCAI_LOCAL_PARSE: '1' })).toBe(true)
    expect(isLocalParseEnabled({ GCAI_LOCAL_PARSE: 'true' })).toBe(false)
    expect(isLocalParseEnabled({})).toBe(false)
  })

  it('rejects non-allowlisted models fail-closed', () => {
    expect(() => requireLocalParseModel({
      GCAI_LOCAL_PARSE: '1',
      GCAI_LOCAL_PARSE_MODEL: 'claude-sonnet-4-5-20250929',
    })).toThrow('local_parse_configuration_invalid')
  })
})

describe('validateLocalParseResult', () => {
  it('requires verbatim step descriptions', () => {
    const bad = okPayload({
      steps: [{
        stepNumber: 1,
        description: 'Add EtOH and watch TLC',
        chemicals: [{ name: 'ethanol', role: 'solvent', quantity: '5 mL' }],
        conditions: {},
      }],
    })
    expect(validateLocalParseResult(TEXT, bad)).toEqual({ ok: false, reason: 'step_0_not_anchored' })
  })

  it('maps legacy roles to unknown and accepts anchored steps', () => {
    expect(mapParseRole('workup')).toBe('unknown')
    const good = validateLocalParseResult(TEXT, okPayload())
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.result.steps[0].chemicals[0].role).toBe('solvent')
  })
})

describe('parseProtocolLocal', () => {
  it('calls loopback Ollama with structured format and never Anthropic', async () => {
    const fetchImpl = mockOllama(okPayload())
    const result = await parseProtocolLocal({
      protocolText: TEXT,
      model: MODEL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.steps).toHaveLength(1)
    expect(result.repaired).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/chat')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe(MODEL)
    expect(body.format.type).toBe('object')
    expect(body.stream).toBe(false)
  })

  it('repairs once when the first answer is not source-anchored', async () => {
    const bad = okPayload({
      steps: [{
        stepNumber: 1,
        description: 'paraphrased step',
        chemicals: [{ name: 'ethanol', role: 'solvent', quantity: '5 mL' }],
        conditions: {},
      }],
    })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: MODEL, done: true, done_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(bad) },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: MODEL, done: true, done_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(okPayload()) },
      }), { status: 200 }))

    const result = await parseProtocolLocal({
      protocolText: TEXT,
      model: MODEL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.repaired).toBe(true)
    expect(result.steps[0].description).toBe(TEXT)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('fails closed after a failed repair with no Anthropic fallback', async () => {
    const bad = okPayload({
      steps: [{
        stepNumber: 1,
        description: 'still wrong',
        chemicals: [{ name: 'ethanol', role: 'solvent', quantity: '5 mL' }],
        conditions: {},
      }],
    })
    const fetchImpl = mockOllama(bad)
    await expect(parseProtocolLocal({
      protocolText: TEXT,
      model: MODEL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow(/local_parse_invalid/)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('score adapters', () => {
  it('flattens chemicals for /score local helpers', () => {
    const steps = adaptStepsForLocalHelpers(TEXT, [{
      stepNumber: 1,
      description: TEXT,
      chemicals: [{ name: 'ethanol', role: 'workup', quantity: '5 mL' }],
      conditions: {},
    }])
    expect(steps[0].chemicals[0].role).toBe('unknown')
    expect(flattenChemicalsForScore(steps)).toEqual([
      { name: 'ethanol', role: 'unknown', quantity: '5 mL' },
    ])
  })
})
