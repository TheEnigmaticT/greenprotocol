import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiteratureEvidenceMatch, Recommendation } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  evidenceSearch: vi.fn(),
  isLocalPipeline: vi.fn(() => false),
  batchConvert: vi.fn(),
  scoreProtocol: vi.fn(),
  isServiceAvailable: vi.fn().mockResolvedValue(false),
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

vi.mock('@/lib/literature-evidence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/literature-evidence')>('@/lib/literature-evidence')
  return {
    ...actual,
    searchLiteratureEvidence: mocks.evidenceSearch,
    citationFromEvidenceMatch: (match: LiteratureEvidenceMatch) => ({
      source_id: match.id,
      source_name: match.title,
      citation: `${match.title}. pp. ${match.pageStart}–${match.pageEnd}.`,
      doi: match.doi,
    }),
  }
})

vi.mock('@/lib/local-llm', async () => {
  const actual = await vi.importActual<typeof import('@/lib/local-llm')>('@/lib/local-llm')
  return {
    ...actual,
    isLocalPipelineEnabled: mocks.isLocalPipeline,
  }
})
vi.mock('@/lib/local-parse', async () => {
  const actual = await vi.importActual<typeof import('@/lib/local-parse')>('@/lib/local-parse')
  return {
    ...actual,
    isLocalParseEnabled: () => false,
  }
})

import { analyzeProtocol, deriveEvidenceTier, rankRecommendations } from '@/lib/pipeline'

function makeRec(overrides: Partial<Recommendation>): Recommendation {
  return {
    stepNumber: 1,
    principleNumbers: [5],
    principleNames: ['Safer Solvents'],
    severity: 'medium',
    original: { chemical: 'DMF', issue: 'toxic' },
    alternative: { chemical: 'DMSO', rationale: 'safer', yieldImpact: '', caveats: '', evidenceBasis: '' },
    confidenceLevel: 'medium',
    ...overrides,
  }
}

function candidateMatch(id: string): LiteratureEvidenceMatch {
  return {
    id,
    sourceDocumentId: 'doi:10.1039/example',
    doi: '10.1039/example',
    title: 'Page-Bounded Green Solvent Study',
    pageStart: 4,
    pageEnd: 4,
    quote: 'Ethyl acetate replaced dichloromethane with comparable extraction yields.',
    evidenceType: 'comparison',
    applicability: 'Liquid-liquid extraction',
    limitations: 'Requires solvent-volume optimization.',
    candidateStatus: 'candidate_pending_adjudication',
    similarity: 0.91,
  }
}

function toolResult(input: Record<string, unknown>) {
  return {
    id: 'tool',
    type: 'tool_use',
    name: 'return_result',
    input,
  }
}

function anthropicResponse(input: Record<string, unknown>) {
  return {
    content: [toolResult(input)],
    usage: { input_tokens: 1, output_tokens: 1 },
    stop_reason: 'tool_use',
  }
}

beforeEach(() => {
  mocks.anthropicCreate.mockReset()
  mocks.evidenceSearch.mockReset().mockResolvedValue([])
  mocks.isLocalPipeline.mockReset().mockReturnValue(false)
  mocks.batchConvert.mockReset()
  mocks.scoreProtocol.mockReset()
  mocks.isServiceAvailable.mockReset().mockResolvedValue(false)
})

describe('deriveEvidenceTier', () => {
  it('returns sourced when citations present', () => {
    const rec = makeRec({
      evidence: {
        why_flagged: [],
        why_replacement: [],
        citations: [{ source_id: 'x', source_name: 'J. GC', citation: 'Smith 2023', url: undefined }],
      },
    })
    expect(deriveEvidenceTier(rec)).toBe('sourced')
  })

  it('returns inferred when no evidence', () => {
    expect(deriveEvidenceTier(makeRec({}))).toBe('inferred')
  })

  it('returns inferred when citations array is empty', () => {
    const rec = makeRec({
      evidence: { why_flagged: [], why_replacement: [], citations: [] },
    })
    expect(deriveEvidenceTier(rec)).toBe('inferred')
  })
})

describe('rankRecommendations', () => {
  it('sorts sourced above inferred at equal severity', () => {
    const inferred = makeRec({ severity: 'high', evidenceTier: 'inferred' })
    const sourced = makeRec({ severity: 'high', evidenceTier: 'sourced' })
    const [first] = rankRecommendations([inferred, sourced])
    expect(first).toBe(sourced)
  })

  it('keeps high-severity inferred above low-severity sourced', () => {
    const highInferred = makeRec({ severity: 'high', evidenceTier: 'inferred' })
    const lowSourced = makeRec({ severity: 'low', evidenceTier: 'sourced' })
    const [first] = rankRecommendations([lowSourced, highInferred])
    expect(first).toBe(highInferred)
  })

  it('sourced-medium ties inferred-high — sourced wins tiebreak', () => {
    const infHigh = makeRec({ severity: 'high', evidenceTier: 'inferred' })  // 3 × 1.0 = 3.0
    const srcMed = makeRec({ severity: 'medium', evidenceTier: 'sourced' })  // 2 × 1.5 = 3.0
    const [first] = rankRecommendations([infHigh, srcMed])
    expect(first).toBe(srcMed)
  })
})

describe('Phase 2.5 evidence grounding', () => {
  it('attaches a page-bounded candidate citation in Phase 2.5', async () => {
    mocks.isLocalPipeline.mockReturnValue(false)
    mocks.evidenceSearch.mockResolvedValue([candidateMatch('doi:p4:u2')])
    mocks.anthropicCreate
      .mockResolvedValueOnce(anthropicResponse({
        protocolTitle: 'Extraction',
        chemistrySubdomain: 'Organic synthesis',
        steps: [{
          stepNumber: 1,
          description: 'Extract with dichloromethane.',
          chemicals: [{ name: 'Dichloromethane', role: 'solvent' }],
          conditions: {},
        }],
      }))
      .mockImplementation(({ system }: { system: string }) => {
        if (system.includes('protocol writer')) {
          return Promise.resolve(anthropicResponse({
            revisedProtocol: 'Revised extraction protocol.',
            overallAssessment: {
              greenPrinciplesViolated: [5],
              mostImpactfulChange: 'Replace dichloromethane.',
              experimentalValidationNeeded: true,
              disclaimer: 'Validate experimentally.',
            },
          }))
        }
        if (system.includes('critical re-evaluation')) {
          return Promise.resolve(anthropicResponse({
            action: 'confirm',
            revisedConfidence: 'medium',
            revisedRationale: 'Evidence supports further validation.',
            evidenceAssessment: {
              supportsOriginalIssue: true,
              supportsAlternative: false,
              contextMatch: 'partial',
              quantitativeData: true,
            },
            concerns: ['Candidate evidence requires adjudication.'],
          }))
        }
        return Promise.resolve(anthropicResponse({
          principleNumber: 5,
          recommendations: system.includes('Principle 5')
            ? [makeRec({})]
            : [],
        }))
      })

    const result = await analyzeProtocol('Extract with dichloromethane.')

    expect(result.recommendations[0].evidence?.citations).toContainEqual(
      expect.objectContaining({
        source_id: 'doi:p4:u2',
        citation: expect.stringContaining('p. 4'),
      }),
    )
    expect(result.recommendations[0].evidence?.why_replacement).toContainEqual(
      expect.objectContaining({
        content: expect.stringContaining('Candidate evidence'),
      }),
    )
    expect(result.recommendations[0].applicationEligibility).toMatchObject({
      status: 'hypothesis_only',
    })
    expect(result.revisedProtocol).toBe('Extract with dichloromethane.')
  })
})

describe.each(['confirm', 'suppress'] as const)(
  'Phase 2.7 candidate-only re-evaluation (hard mode)',
  action => {
    it(`does not ${action} a recommendation from candidate-only evidence`, async () => {
      mocks.isLocalPipeline.mockReturnValue(false)
      mocks.evidenceSearch.mockResolvedValue([candidateMatch('doi:p4:u2')])
      mocks.anthropicCreate
        .mockResolvedValueOnce(anthropicResponse({
          protocolTitle: 'Extraction',
          chemistrySubdomain: 'Organic synthesis',
          steps: [{
            stepNumber: 1,
            description: 'Extract with dichloromethane.',
            chemicals: [{ name: 'Dichloromethane', role: 'solvent' }],
            conditions: {},
          }],
        }))
        .mockImplementation(({ system }: { system: string }) => {
          if (system.includes('protocol writer')) {
            return Promise.resolve(anthropicResponse({
              revisedProtocol: 'Revised extraction protocol.',
              overallAssessment: {
                greenPrinciplesViolated: [5],
                mostImpactfulChange: 'Replace dichloromethane.',
                experimentalValidationNeeded: true,
                disclaimer: 'Validate experimentally.',
              },
            }))
          }
          if (system.includes('critical re-evaluation')) {
            return Promise.resolve(anthropicResponse({
              action,
              revisedConfidence: 'high',
              revisedRationale: 'Candidate-only result.',
              evidenceAssessment: {
                supportsOriginalIssue: true,
                supportsAlternative: true,
                contextMatch: 'strong',
                quantitativeData: true,
              },
              concerns: [],
              suppressionReason: 'Candidate-only result.',
            }))
          }
          return Promise.resolve(anthropicResponse({
            principleNumber: 5,
            recommendations: system.includes('Principle 5') ? [makeRec({})] : [],
          }))
        })

      const result = await analyzeProtocol('Extract with dichloromethane.')

      expect(result.recommendations).toHaveLength(1)
      expect(result.recommendations[0].confidenceLevel).toBe('low')
      expect(result.reevaluationStats).toMatchObject({
        confirmed: 0,
        suppressed: 0,
        downgraded: 1,
      })
    })
  },
)

describe('predecision evidence sequencing', () => {
  it('puts score-service reaction evidence in principle requests before generation', async () => {
    mocks.isServiceAvailable.mockResolvedValue(true)
    mocks.batchConvert.mockResolvedValue({ results: [{ chemical_name: 'ethanol', smiles: 'CCO', molecular_formula: 'C2H6O', molecular_weight: 46.07, density_g_per_ml: 0.789, quantity_g: 46.07, quantity_kg: 0.04607, quantity_mol: 1, ghs_hazards: [], green_alternatives: [], citations: [], data_source: 'pubchem', cached: true, warnings: [], error: null }] })
    mocks.scoreProtocol.mockResolvedValue({ scores: [], total_score: 0, max_possible: 0, grade: 'C', smiles_extraction: { reaction_smiles: 'CCO>>CC=O', validated: true, source: 'chemistry-service' }, yield_extraction: {} })
    mocks.evidenceSearch.mockResolvedValue([{ ...candidateMatch('predecision-unit'), quote: 'Ethanol oxidation was described under different reaction conditions.' }])
    const principleUsers: string[] = []
    mocks.anthropicCreate
      .mockResolvedValueOnce(anthropicResponse({ protocolTitle: 'Oxidation', chemistrySubdomain: 'Organic synthesis', steps: [{ stepNumber: 1, description: 'Oxidize ethanol.', chemicals: [{ name: 'ethanol', role: 'reactant', quantity: '1 mol' }], conditions: {} }] }))
      .mockImplementation(({ system, messages }: { system: string; messages: Array<{ content: string }> }) => {
        if (system.includes('protocol writer')) return Promise.resolve(anthropicResponse({ revisedProtocol: 'Oxidize ethanol.', overallAssessment: { greenPrinciplesViolated: [], mostImpactfulChange: 'None', experimentalValidationNeeded: true, disclaimer: 'Validate.' } }))
        principleUsers.push(messages[0].content)
        return Promise.resolve(anthropicResponse({ principleNumber: 1, recommendations: [] }))
      })

    const result = await analyzeProtocol('Oxidize ethanol to acetaldehyde.')

    expect(principleUsers).toHaveLength(12)
    expect(mocks.evidenceSearch.mock.invocationCallOrder[0]).toBeLessThan(mocks.anthropicCreate.mock.invocationCallOrder[1])
    for (const message of principleUsers) {
      expect(message).toContain('Validated reaction representation: CCO>>CC=O')
      expect(message).toContain('source_id=predecision-unit')
    }
    expect(result.predecisionEvidence).toContain('No applicable reaction precedent is established')
  })

  it('does not attach another compound’s hazards through a substring name match', async () => {
    mocks.isServiceAvailable.mockResolvedValue(true)
    mocks.batchConvert.mockResolvedValue({ results: ['ethanolamine', 'ethanol'].map((name, i) => ({
      chemical_name: name, smiles: i === 0 ? 'NCCO' : 'CCO', quantity_g: 1, quantity_kg: 0.001,
      ghs_hazards: [{ code: i === 0 ? 'H314' : 'H225', description: name, source: 'test fixture' }],
      green_alternatives: [], citations: [], data_source: 'cache', cached: true, warnings: [], error: null,
    })) })
    mocks.scoreProtocol.mockResolvedValue(null)
    mocks.anthropicCreate.mockResolvedValueOnce(anthropicResponse({
      protocolTitle: 'Identity fixture', chemistrySubdomain: 'Organic synthesis',
      steps: [{ stepNumber: 1, description: 'Handle ethanolamine and ethanol separately.',
        chemicals: ['ethanolamine', 'ethanol'].map(name => ({ name, role: 'solvent', quantity: '1 g' })), conditions: {} }],
    })).mockImplementation(({ system }: { system: string }) => Promise.resolve(anthropicResponse({
      principleNumber: 5,
      recommendations: system.includes('Principle 5') ? [makeRec({ original: { chemical: 'ethanol', issue: 'flammability' } })] : [],
    })))
    const result = await analyzeProtocol('Handle ethanolamine and ethanol separately.')
    const flagged = result.recommendations[0].evidence?.why_flagged
    expect(flagged).toEqual([expect.objectContaining({ content: 'H225: ethanol' })])
  })
})
