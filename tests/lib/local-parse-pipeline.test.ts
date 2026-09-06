import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  parseLocal: vi.fn(),
  isLocal: vi.fn(),
  requireModel: vi.fn(),
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
vi.mock('@/lib/literature-evidence', () => ({
  searchLiteratureEvidence: vi.fn().mockResolvedValue([]),
  citationFromEvidenceMatch: vi.fn(),
}))
vi.mock('@/lib/trace', () => ({ logLLMTrace: vi.fn(), logDedupTrace: vi.fn() }))
vi.mock('@/lib/local-parse', async () => {
  const actual = await vi.importActual<typeof import('@/lib/local-parse')>('@/lib/local-parse')
  return {
    ...actual,
    isLocalParseEnabled: mocks.isLocal,
    requireLocalParseModel: mocks.requireModel,
    parseProtocolLocal: mocks.parseLocal,
  }
})

import { analyzeProtocol } from '@/lib/pipeline'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isLocal.mockReturnValue(true)
  mocks.requireModel.mockReturnValue('hf.co/unsloth/Qwen3.8-27B-GGUF:Q4_K_M')
  mocks.parseLocal.mockResolvedValue({
    protocolTitle: 'Ethanol Addition',
    chemistrySubdomain: 'Organic Synthesis',
    steps: [{
      stepNumber: 1,
      description: 'Add ethanol (5 mL). Monitor by TLC.',
      chemicals: [{ name: 'ethanol', role: 'solvent', quantity: '5 mL', quantityMl: null, quantityKg: null }],
      conditions: { temperature: null, duration: null, atmosphere: null },
    }],
    model: 'hf.co/unsloth/Qwen3.8-27B-GGUF:Q4_K_M',
    repaired: false,
  })
  // Phase 2 still hits Anthropic today; keep it from exploding so we can assert parse routing.
  mocks.create.mockResolvedValue({
    stop_reason: 'tool_use',
    usage: { input_tokens: 1, output_tokens: 1 },
    content: [{
      type: 'tool_use',
      input: { principleNumber: 1, recommendations: [] },
    }],
  })
})

describe('pipeline local parse routing', () => {
  it('uses local parse and never Anthropic for Phase 1 when enabled', async () => {
    await analyzeProtocol('Add ethanol (5 mL). Monitor by TLC.')
    expect(mocks.parseLocal).toHaveBeenCalledTimes(1)
    expect(mocks.parseLocal.mock.calls[0][0].protocolText).toContain('ethanol')
    const parseCalls = mocks.create.mock.calls.filter((args) =>
      typeof args[0]?.system === 'string' && args[0].system.includes('chemistry protocol parser')
    )
    expect(parseCalls).toHaveLength(0)
  })
})
