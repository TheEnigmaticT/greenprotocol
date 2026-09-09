import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import capturedParse from '../../benchmarks/engine-candidate/unnamed-product-parse-regression.json'

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  qwenCall: vi.fn(),
  logLLMTrace: vi.fn(),
  batchConvert: vi.fn(),
  scoreProtocol: vi.fn(),
  isServiceAvailable: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mocks.anthropicCreate }
  },
}))

vi.mock('@/lib/qwen-adapter', () => ({
  QWEN_MODEL: 'qwen/qwen3.8-27b',
  callQwen: mocks.qwenCall,
}))

vi.mock('@/lib/chemistry-service', () => ({
  batchConvert: mocks.batchConvert,
  scoreProtocol: mocks.scoreProtocol,
  isServiceAvailable: mocks.isServiceAvailable,
}))

vi.mock('@/lib/literature-evidence', () => ({
  searchLiteratureEvidence: vi.fn(),
  citationFromEvidenceMatch: vi.fn(),
}))

vi.mock('@/lib/trace', () => ({
  logLLMTrace: mocks.logLLMTrace,
  logDedupTrace: vi.fn(),
}))

import { analyzeProtocol } from '@/lib/pipeline'

const originalFlag = process.env.GCAI_QWEN_PARITY

describe('pipeline Qwen opt-in', () => {
  beforeEach(() => {
    process.env.GCAI_QWEN_PARITY = '1'
    mocks.anthropicCreate.mockReset()
    mocks.qwenCall.mockReset()
    mocks.batchConvert.mockReset()
    mocks.scoreProtocol.mockReset()
    mocks.isServiceAvailable.mockReset().mockResolvedValue(false)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    if (originalFlag === undefined) delete process.env.GCAI_QWEN_PARITY
    else process.env.GCAI_QWEN_PARITY = originalFlag
  })

  it('does not fall back to Anthropic when the opted-in Qwen transport fails', async () => {
    mocks.qwenCall.mockRejectedValue(new Error('Qwen transport failed for parse: provider request failed'))
    mocks.logLLMTrace.mockResolvedValue(undefined)

    await expect(analyzeProtocol('Add water.', undefined, { userId: 'test-user' }))
      .rejects.toThrow('Qwen transport failed for parse: provider request failed')

    expect(mocks.qwenCall).toHaveBeenCalledOnce()
    expect(mocks.anthropicCreate).not.toHaveBeenCalled()
    expect(mocks.logLLMTrace).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'qwen/qwen3.8-27b' }),
      undefined,
    )
  })

  it('limits candidate principle calls while completing every principle', async () => {
    vi.stubEnv('GCAI_ENGINE_CANDIDATE', '1')
    let active = 0
    let peak = 0
    mocks.qwenCall.mockImplementation(async ({ label }: { label: string }) => {
      let input: unknown
      if (label === 'parse') input = {
        protocolTitle: 'Wash', chemistrySubdomain: 'Processing', steps: [{
          stepNumber: 1, description: 'Wash with water.', conditions: {},
          chemicals: [
            { name: 'water', role: 'workup', quantity: '', quantityKg: 99, quantityMl: 99 },
            { name: 'invented product', role: 'product', quantity: '' },
          ],
        }],
      }
      else {
        active++
        peak = Math.max(active, peak)
        await new Promise(resolve => setTimeout(resolve, 1))
        active--
        input = { principleNumber: Number(label.split('-')[1]), recommendations: [] }
      }
      return { content: [{ type: 'tool_use', name: 'return_result', input }], usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: 'tool_calls' }
    })
    const progress = vi.fn()
    const result = await analyzeProtocol('Wash with water.', progress)
    expect(peak).toBeLessThanOrEqual(2)
    expect(progress.mock.calls.filter(([event]) => event.type === 'principle' && event.status === 'complete')).toHaveLength(12)
    expect(result.revisedProtocol).toBe('Wash with water.')
    expect(result.steps[0].chemicals[0].quantityKg).toBeNull()
    expect(result.steps[0].chemicals[0].quantityMl).toBeNull()
    expect(result.steps[0].chemicals).toHaveLength(1)
    expect(result.inputWarnings?.[0]).toContain('not explicitly named')
    expect(mocks.qwenCall.mock.calls[0][0].system).toContain('declared product')
    expect(mocks.qwenCall.mock.calls[0][0].system).toContain('Do not invent chemical identities')
  })

  it.each([
    { candidate: '1', explicitlyNamed: false, productCount: 0 },
    { candidate: '1', explicitlyNamed: true, productCount: 1 },
    { candidate: '', explicitlyNamed: false, productCount: 1 },
  ])('grounds the captured parse before enrichment/scoring (candidate=$candidate, named=$explicitlyNamed)', async ({ candidate, explicitlyNamed, productCount }) => {
    vi.stubEnv('GCAI_ENGINE_CANDIDATE', candidate)
    mocks.isServiceAvailable.mockResolvedValue(true)
    mocks.batchConvert.mockResolvedValue({ results: [] })
    mocks.scoreProtocol.mockResolvedValue(null)
    mocks.qwenCall.mockImplementation(async ({ label }: { label: string }) => ({
      content: [{ type: 'tool_use', name: 'return_result', input: label === 'parse'
        ? structuredClone(capturedParse.parseResult)
        : { principleNumber: Number(label.split('-')[1]), recommendations: [] } }],
      usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: 'tool_calls',
    }))
    const product = '4-hydroxybenzoic acid methyl ester'
    const source = capturedParse.protocolText + (explicitlyNamed ? ` Isolate ${product}.` : '')
    const result = await analyzeProtocol(source)
    expect(result.steps.flatMap(step => step.chemicals).filter(c => c.role === 'product')).toHaveLength(productCount)
    expect(mocks.batchConvert).toHaveBeenCalledOnce()
    const enrichedNames = mocks.batchConvert.mock.calls[0][0].map((c: { name: string }) => c.name)
    expect(enrichedNames.includes(product)).toBe(productCount === 1)
    expect(mocks.scoreProtocol).toHaveBeenCalledOnce()
    const scoreRequest = mocks.scoreProtocol.mock.calls[0][0]
    expect(scoreRequest.chemicals.filter((c: { role: string }) => c.role === 'product')).toHaveLength(productCount)
    expect(scoreRequest.steps.flatMap((s: { chemicals: { role: string }[] }) => s.chemicals).filter((c: { role: string }) => c.role === 'product')).toHaveLength(productCount)
    const principleCalls = mocks.qwenCall.mock.calls.filter(([call]) => call.label.startsWith('principle-'))
    expect(principleCalls).toHaveLength(12)
    for (const [call] of principleCalls) expect(call.userContent.includes(product)).toBe(productCount === 1)
    expect(result.inputWarnings?.length).toBe(candidate ? (explicitlyNamed ? 0 : 1) : undefined)
    expect(result.revisedProtocol).toBe(source)
  })

  it('rejects malformed parsing with a clear stage error', async () => {
    mocks.qwenCall.mockResolvedValue({ content: [{ type: 'tool_use', input: {} }], usage: {}, stop_reason: 'tool_calls' })
    await expect(analyzeProtocol('Wash with water.')).rejects.toThrow('Protocol parsing returned no usable steps')
  })
})
