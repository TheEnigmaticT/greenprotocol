import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiteratureEvidenceMatch, Recommendation } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  evidenceSearch: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mocks.anthropicCreate }
  },
}))

vi.mock('@/lib/chemistry-service', () => ({
  batchConvert: vi.fn(),
  scoreProtocol: vi.fn(),
  isServiceAvailable: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/literature-evidence', () => ({
  searchLiteratureEvidence: mocks.evidenceSearch,
  citationFromEvidenceMatch: (match: LiteratureEvidenceMatch) => ({
    source_id: match.id,
    source_name: match.title,
    citation: `${match.title}. pp. ${match.pageStart}–${match.pageEnd}.`,
    doi: match.doi,
  }),
}))


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
  })
})
