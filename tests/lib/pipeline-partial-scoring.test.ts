import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  batchConvert: vi.fn(),
  scoreProtocol: vi.fn(),
  isServiceAvailable: vi.fn(),
  evidenceSearch: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mocks.anthropicCreate }
  },
}))

vi.mock('@/lib/chemistry-service', () => ({
  batchConvert: mocks.batchConvert,
  scoreProtocol: mocks.scoreProtocol,
  isServiceAvailable: mocks.isServiceAvailable,
}))

vi.mock('@/lib/literature-evidence', () => ({
  searchLiteratureEvidence: mocks.evidenceSearch,
  citationFromEvidenceMatch: () => ({ source_id: 'test', source_name: 'Test', citation: 'Test.' }),
}))

import { analyzeProtocol } from '@/lib/pipeline'

function response(input: Record<string, unknown>) {
  return {
    content: [{ id: 'tool', type: 'tool_use', name: 'return_result', input }],
    usage: { input_tokens: 1, output_tokens: 1 },
    stop_reason: 'tool_use',
  }
}

const scoreResult = {
  grade: 'B',
  total_score: 20,
  max_possible: 120,
  smiles_extraction: {},
  yield_extraction: {},
  scores: [{
    principle_number: 8,
    principle_name: 'Reduce Derivatives',
    score: 5,
    max_score: 10,
    normalized: 0.5,
    details: {},
    chemicals_flagged: [],
    data_sources: ['ai_assessment'],
    confidence: 'calculated',
  }],
}

describe('partial chemistry reference data', () => {
  beforeEach(() => {
    mocks.isServiceAvailable.mockResolvedValue(true)
    mocks.batchConvert.mockResolvedValue({
      results: [
        {
          chemical_name: 'brine', smiles: null, molecular_formula: null,
          molecular_weight: null, density_g_per_ml: null, quantity_g: null,
          quantity_kg: null, quantity_mol: null, ghs_hazards: [], green_alternatives: [],
          citations: [], data_source: 'indefinite', cached: false, warnings: [], error: null,
        },
      ],
    })
    mocks.scoreProtocol.mockResolvedValue(scoreResult)
    mocks.evidenceSearch.mockResolvedValue([])
    mocks.anthropicCreate.mockImplementation(({ system }: { system: string }) => {
      if (system.includes('protocol writer')) {
        return Promise.resolve(response({
          revisedProtocol: 'Revised protocol.',
          overallAssessment: {
            greenPrinciplesViolated: [], mostImpactfulChange: 'None.',
            experimentalValidationNeeded: true, disclaimer: 'Validate experimentally.',
          },
        }))
      }
      if (system.includes('critical re-evaluation')) {
        return Promise.resolve(response({
          action: 'confirm', revisedConfidence: 'medium', revisedRationale: 'No change.',
          evidenceAssessment: { supportsOriginalIssue: false, supportsAlternative: false, contextMatch: 'none', quantitativeData: false },
          concerns: [],
        }))
      }
      if (system.includes('protocol parser')) {
        return Promise.resolve(response({
          protocolTitle: 'Brine workup', chemistrySubdomain: 'Organic synthesis',
          steps: [{ stepNumber: 1, description: 'Wash with brine.', chemicals: [{ name: 'brine', role: 'workup', quantity: '10 mL' }], conditions: {} }],
        }))
      }
      return Promise.resolve(response({ principleNumber: 5, recommendations: [] }))
    })
  })

  it('still calls the scorer when an indefinite workup material is present', async () => {
    const analysis = await analyzeProtocol('Wash the product with brine.')

    expect(mocks.scoreProtocol).toHaveBeenCalledOnce()
    expect(analysis.deterministicScores).toEqual(scoreResult)
    expect(analysis.chemistryDataStatus).toMatchObject({
      pending: false,
      deterministicScoringAvailable: true,
      indefiniteChemicals: ['brine'],
    })
  })
})
