import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  parseLocal: vi.fn(),
  isLocalParse: vi.fn(),
  requireParseModel: vi.fn(),
  completeLocal: vi.fn(),
  isLocalPipeline: vi.fn(),
  requirePipelineModel: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.create }
  },
}))
vi.mock('@/lib/chemistry-service', () => ({
  batchConvert: vi.fn().mockResolvedValue(null),
  scoreProtocol: vi.fn().mockResolvedValue(null),
  isServiceAvailable: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/literature-evidence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/literature-evidence')>('@/lib/literature-evidence')
  return {
    ...actual,
    searchLiteratureEvidence: vi.fn().mockResolvedValue([]),
    citationFromEvidenceMatch: vi.fn(),
  }
})
vi.mock('@/lib/trace', () => ({ logLLMTrace: vi.fn(), logDedupTrace: vi.fn() }))
vi.mock('@/lib/local-parse', async () => {
  const actual = await vi.importActual<typeof import('@/lib/local-parse')>('@/lib/local-parse')
  return {
    ...actual,
    isLocalParseEnabled: mocks.isLocalParse,
    requireLocalParseModel: mocks.requireParseModel,
    parseProtocolLocal: mocks.parseLocal,
  }
})
vi.mock('@/lib/local-llm', async () => {
  const actual = await vi.importActual<typeof import('@/lib/local-llm')>('@/lib/local-llm')
  return {
    ...actual,
    isLocalPipelineEnabled: mocks.isLocalPipeline,
    requireLocalPipelineModel: mocks.requirePipelineModel,
    completeLocalJson: mocks.completeLocal,
    completeLocalJsonResult: async (opts: unknown) => ({
      data: await mocks.completeLocal(opts),
      usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
    }),
  }
})

import { analyzeProtocol } from '@/lib/pipeline'

const MODEL = 'hf.co/unsloth/Qwen3.8-27B-GGUF:Q4_K_M'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isLocalParse.mockReturnValue(true)
  mocks.requireParseModel.mockReturnValue(MODEL)
  mocks.isLocalPipeline.mockReturnValue(true)
  mocks.requirePipelineModel.mockReturnValue(MODEL)
  mocks.parseLocal.mockResolvedValue({
    protocolTitle: 'Ethanol Addition',
    chemistrySubdomain: 'Organic Synthesis',
    steps: [{
      stepNumber: 1,
      description: 'Add ethanol (5 mL). Monitor by TLC.',
      chemicals: [{ name: 'ethanol', role: 'solvent', quantity: '5 mL', quantityMl: null, quantityKg: null }],
      conditions: { temperature: null, duration: null, atmosphere: null },
    }],
    model: MODEL,
    repaired: false,
  })
  mocks.completeLocal.mockImplementation(async ({ label }: { label?: string }) => {
    if (label?.startsWith('principle-')) {
      const n = Number(label.split('-')[1])
      return { principleNumber: n, recommendations: [] }
    }
    if (label === 'assemble') {
      return {
        revisedProtocol: 'Add water instead.',
        overallAssessment: {
          greenPrinciplesViolated: [],
          mostImpactfulChange: 'none',
          experimentalValidationNeeded: true,
          disclaimer: 'test',
        },
      }
    }
    if (label?.startsWith('reevaluate-')) {
      return {
        action: 'confirm',
        revisedConfidence: 'medium',
        revisedRationale: 'ok',
        evidenceAssessment: {
          supportsOriginalIssue: true,
          supportsAlternative: true,
          contextMatch: 'partial',
          quantitativeData: false,
        },
        concerns: [],
      }
    }
    return {}
  })
})

describe('full local pipeline routing', () => {
  it('never calls Anthropic when local pipeline is enabled', async () => {
    await analyzeProtocol('Add ethanol (5 mL). Monitor by TLC.')
    expect(mocks.parseLocal).toHaveBeenCalled()
    expect(mocks.completeLocal).toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    const principleLabels = mocks.completeLocal.mock.calls
      .map((c) => c[0]?.label)
      .filter(
        (l: string) =>
          typeof l === 'string' && /^principle-\d+$/.test(l),
      )
    expect(principleLabels.length).toBe(12)
  })

  it('keeps a principle rejected when local validation fails closed (no empty success)', async () => {
    const events: { type: string; status?: string; number?: number }[] = []
    mocks.completeLocal.mockImplementation(async ({ label }: { label?: string }) => {
      if (label === 'principle-1') {
        return { principleNumber: 1 } // recommendations missing → invalid
      }
      if (label?.startsWith('principle-')) {
        const n = Number(label.split('-')[1])
        return { principleNumber: n, recommendations: [] }
      }
      if (label === 'assemble') {
        return {
          revisedProtocol: 'Add water instead.',
          overallAssessment: {
            greenPrinciplesViolated: [],
            mostImpactfulChange: 'none',
            experimentalValidationNeeded: true,
            disclaimer: 'test',
          },
        }
      }
      if (label?.startsWith('reevaluate-')) {
        return {
          action: 'confirm',
          revisedConfidence: 'medium',
          revisedRationale: 'ok',
          evidenceAssessment: {
            supportsOriginalIssue: true,
            supportsAlternative: true,
            contextMatch: 'partial',
            quantitativeData: false,
          },
          concerns: [],
        }
      }
      return {}
    })

    await analyzeProtocol('Add ethanol (5 mL). Monitor by TLC.', (e) => {
      events.push(e as { type: string; status?: string; number?: number })
    })

    const p1 = events.filter((e) => e.type === 'principle' && e.number === 1)
    expect(p1.some((e) => e.status === 'failed')).toBe(true)
    expect(p1.some((e) => e.status === 'complete')).toBe(false)
    // First attempt + one repair for principle-1
    const p1Calls = mocks.completeLocal.mock.calls.filter((c) => c[0]?.label === 'principle-1')
    expect(p1Calls.length).toBe(2)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
