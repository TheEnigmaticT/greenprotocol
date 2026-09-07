import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_PIPELINE_MODELS } from '@/lib/local-llm'
import {
  buildLocalRepairAddendum,
  completeLocalJsonValidated,
  selectLocalResultValidator,
  validateAssembleResult,
  validatePrincipleResult,
  validateReevaluationResult,
} from '@/lib/local-result-validate'

const MODEL = LOCAL_PIPELINE_MODELS[1]

function okPrinciple(overrides: Record<string, unknown> = {}) {
  return {
    principleNumber: 5,
    recommendations: [{
      stepNumber: 1,
      severity: 'medium',
      confidenceLevel: 'high',
      original: { chemical: 'DCM', issue: 'chlorinated solvent' },
      alternative: { chemical: 'ethyl acetate', rationale: 'safer solvent' },
    }],
    ...overrides,
  }
}

function okAssemble(overrides: Record<string, unknown> = {}) {
  return {
    revisedProtocol: 'Use ethyl acetate instead of DCM.',
    overallAssessment: {
      greenPrinciplesViolated: [5],
      mostImpactfulChange: 'Replace DCM',
      experimentalValidationNeeded: true,
      disclaimer: 'Validate experimentally.',
    },
    ...overrides,
  }
}

function okReeval(overrides: Record<string, unknown> = {}) {
  return {
    action: 'confirm',
    revisedConfidence: 'medium',
    revisedRationale: 'Literature supports swap',
    evidenceAssessment: {
      supportsOriginalIssue: true,
      supportsAlternative: true,
      contextMatch: 'partial',
      quantitativeData: false,
    },
    concerns: [],
    ...overrides,
  }
}

function mockOllama(content: unknown, model = MODEL) {
  return vi.fn(async () => new Response(JSON.stringify({
    model,
    done: true,
    done_reason: 'stop',
    message: { role: 'assistant', content: JSON.stringify(content) },
    prompt_eval_count: 10,
    eval_count: 20,
  }), { status: 200 }))
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('validatePrincipleResult', () => {
  it('accepts empty recommendations array', () => {
    const v = validatePrincipleResult({ principleNumber: 1, recommendations: [] })
    expect(v.ok).toBe(true)
  })

  it('rejects missing or non-array recommendations', () => {
    expect(validatePrincipleResult({ principleNumber: 1 })).toEqual({
      ok: false,
      reason: 'recommendations_not_array',
    })
    expect(validatePrincipleResult({ principleNumber: 1, recommendations: null })).toEqual({
      ok: false,
      reason: 'recommendations_not_array',
    })
    expect(validatePrincipleResult({ principleNumber: 1, recommendations: 'none' })).toEqual({
      ok: false,
      reason: 'recommendations_not_array',
    })
  })

  it('rejects recs missing downstream-required fields', () => {
    expect(validatePrincipleResult(okPrinciple({
      recommendations: [{ stepNumber: 1, severity: 'high', confidenceLevel: 'low' }],
    })).ok).toBe(false)
    expect(validatePrincipleResult(okPrinciple({
      recommendations: [{
        stepNumber: 1,
        severity: 'high',
        confidenceLevel: 'low',
        original: { chemical: '', issue: 'x' },
        alternative: { chemical: 'y', rationale: 'z' },
      }],
    }))).toEqual({ ok: false, reason: 'rec_0_original_chemical' })
    expect(validatePrincipleResult(okPrinciple({
      recommendations: [{
        stepNumber: 1,
        severity: 'nope',
        confidenceLevel: 'low',
        original: { chemical: 'a', issue: 'b' },
        alternative: { chemical: 'c', rationale: 'd' },
      }],
    }))).toEqual({ ok: false, reason: 'rec_0_severity' })
  })

  it('accepts a well-formed recommendation', () => {
    const v = validatePrincipleResult(okPrinciple())
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.result.recommendations).toHaveLength(1)
  })
})

describe('validateAssembleResult', () => {
  it('requires revisedProtocol string and overallAssessment keys', () => {
    expect(validateAssembleResult(okAssemble()).ok).toBe(true)
    expect(validateAssembleResult({
      revisedProtocol: 1,
      overallAssessment: okAssemble().overallAssessment,
    })).toEqual({ ok: false, reason: 'revisedProtocol' })
    expect(validateAssembleResult({
      revisedProtocol: 'x',
      overallAssessment: {
        greenPrinciplesViolated: [],
        mostImpactfulChange: '',
        experimentalValidationNeeded: true,
        disclaimer: 'd',
      },
    })).toEqual({ ok: false, reason: 'mostImpactfulChange' })
  })
})

describe('validateReevaluationResult', () => {
  it('requires Phase 2.7 shape and suppress reason', () => {
    expect(validateReevaluationResult(okReeval()).ok).toBe(true)
    expect(validateReevaluationResult(okReeval({ action: 'maybe' }))).toEqual({
      ok: false,
      reason: 'action',
    })
    expect(validateReevaluationResult(okReeval({
      action: 'suppress',
      suppressionReason: '',
    }))).toEqual({ ok: false, reason: 'suppressionReason' })
    expect(validateReevaluationResult(okReeval({
      action: 'suppress',
      suppressionReason: 'contradicted by lit',
    })).ok).toBe(true)
  })
})

describe('selectLocalResultValidator / repair addendum', () => {
  it('maps principle / assemble / reevaluate labels only', () => {
    expect(selectLocalResultValidator('principle-3')).toBe(validatePrincipleResult)
    expect(selectLocalResultValidator('assemble')).toBe(validateAssembleResult)
    expect(selectLocalResultValidator('reevaluate-step1-DCM')).toBe(validateReevaluationResult)
    expect(selectLocalResultValidator('parse')).toBeNull()
  })

  it('mentions the validation reason in repair addenda', () => {
    expect(buildLocalRepairAddendum('recommendations_not_array', 'principle-1'))
      .toContain('recommendations_not_array')
    expect(buildLocalRepairAddendum('disclaimer', 'assemble')).toContain('disclaimer')
  })
})

describe('completeLocalJsonValidated repair-once', () => {
  it('returns first valid payload without a second fetch', async () => {
    const fetchImpl = mockOllama(okPrinciple())
    const result = await completeLocalJsonValidated({
      system: 'sys',
      user: 'user',
      schema: { type: 'object' },
      model: MODEL,
      label: 'principle-5',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { GCAI_LOCAL_PIPELINE: '1', GCAI_LOCAL_MODEL: MODEL, GCAI_LOCAL_THINK: '0', GCAI_LOCAL_REASONING_EFFORT: 'low' },
    })
    expect(result.data).toMatchObject({ principleNumber: 5 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('repairs once when first JSON fails validation', async () => {
    const bad = { principleNumber: 5, recommendations: 'oops' }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: MODEL, done: true, done_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(bad) },
        prompt_eval_count: 1, eval_count: 1,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: MODEL, done: true, done_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(okPrinciple()) },
        prompt_eval_count: 1, eval_count: 1,
      }), { status: 200 }))

    const result = await completeLocalJsonValidated({
      system: 'sys',
      user: 'user',
      schema: { type: 'object' },
      model: MODEL,
      label: 'principle-5',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { GCAI_LOCAL_PIPELINE: '1', GCAI_LOCAL_MODEL: MODEL, GCAI_LOCAL_THINK: '0', GCAI_LOCAL_REASONING_EFFORT: 'low' },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const repairBody = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body))
    expect(repairBody.messages[0].content).toContain('recommendations_not_array')
    expect(result.data).toMatchObject({ principleNumber: 5, recommendations: expect.any(Array) })
  })

  it('fails closed after a failed repair (no empty success)', async () => {
    const bad = { principleNumber: 5 } // recommendations missing
    const fetchImpl = mockOllama(bad)
    await expect(completeLocalJsonValidated({
      system: 'sys',
      user: 'user',
      schema: { type: 'object' },
      model: MODEL,
      label: 'principle-5',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { GCAI_LOCAL_PIPELINE: '1', GCAI_LOCAL_MODEL: MODEL, GCAI_LOCAL_THINK: '0', GCAI_LOCAL_REASONING_EFFORT: 'low' },
    })).rejects.toThrow(/local_pipeline_invalid:principle-5:recommendations_not_array/)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('repairs assemble and reevaluate labels likewise', async () => {
    const fetchAssemble = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: MODEL, done: true, done_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify({ revisedProtocol: 1 }) },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: MODEL, done: true, done_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(okAssemble()) },
      }), { status: 200 }))

    await completeLocalJsonValidated({
      system: 'sys', user: 'user', schema: { type: 'object' }, model: MODEL,
      label: 'assemble',
      fetchImpl: fetchAssemble as unknown as typeof fetch,
      env: { GCAI_LOCAL_PIPELINE: '1', GCAI_LOCAL_MODEL: MODEL, GCAI_LOCAL_THINK: '0', GCAI_LOCAL_REASONING_EFFORT: 'low' },
    })
    expect(fetchAssemble).toHaveBeenCalledTimes(2)

    const fetchReeval = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: MODEL, done: true, done_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify({ action: 'nope' }) },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: MODEL, done: true, done_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(okReeval()) },
      }), { status: 200 }))

    await completeLocalJsonValidated({
      system: 'sys', user: 'user', schema: { type: 'object' }, model: MODEL,
      label: 'reevaluate-step1-DCM',
      fetchImpl: fetchReeval as unknown as typeof fetch,
      env: { GCAI_LOCAL_PIPELINE: '1', GCAI_LOCAL_MODEL: MODEL, GCAI_LOCAL_THINK: '0', GCAI_LOCAL_REASONING_EFFORT: 'low' },
    })
    expect(fetchReeval).toHaveBeenCalledTimes(2)
  })
})
