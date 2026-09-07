import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  isLocalPipeline: vi.fn(),
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
  }
})
vi.mock('@/lib/trace', () => ({ logLLMTrace: vi.fn(), logDedupTrace: vi.fn() }))
vi.mock('@/lib/local-llm', async () => {
  const actual = await vi.importActual<typeof import('@/lib/local-llm')>('@/lib/local-llm')
  return {
    ...actual,
    isLocalPipelineEnabled: mocks.isLocalPipeline,
  }
})

import {
  enforceCandidateOnlyReevaluation,
  type ReevaluationResult,
} from '@/lib/pipeline'
import type { LiteratureEvidenceMatch } from '@/lib/types'

const candidateMatch: LiteratureEvidenceMatch = {
  id: 'doi:p1:u1',
  sourceDocumentId: 'doi',
  doi: '10.1039/example',
  title: 'Candidate paper',
  pageStart: 1,
  pageEnd: 1,
  quote: 'Ethyl acetate may replace DCM.',
  evidenceType: 'comparison',
  applicability: 'extraction',
  limitations: 'provisional',
  candidateStatus: 'candidate_pending_adjudication',
  similarity: 0.8,
}

const adjudicatedMatch: LiteratureEvidenceMatch = {
  ...candidateMatch,
  id: 'doi:p1:u2',
  candidateStatus: 'adjudicated_accepted',
}

function baseResult(overrides: Partial<ReevaluationResult> = {}): ReevaluationResult {
  return {
    action: 'confirm',
    revisedConfidence: 'high',
    revisedRationale: 'Looks good',
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

beforeEach(() => {
  mocks.isLocalPipeline.mockReset().mockReturnValue(false)
})

describe('enforceCandidateOnlyReevaluation', () => {
  it('hard mode (local OFF): forces confirm → downgrade/low', () => {
    const out = enforceCandidateOnlyReevaluation(
      baseResult({ action: 'confirm', revisedConfidence: 'high' }),
      [candidateMatch],
      false,
    )
    expect(out.action).toBe('downgrade')
    expect(out.revisedConfidence).toBe('low')
    expect(out.concerns.some(c => /candidate-only/i.test(c))).toBe(true)
  })

  it('hard mode (local OFF): maps suppress → downgrade/low', () => {
    const out = enforceCandidateOnlyReevaluation(
      baseResult({ action: 'suppress', revisedConfidence: 'high', suppressionReason: 'bad' }),
      [candidateMatch],
      false,
    )
    expect(out.action).toBe('downgrade')
    expect(out.revisedConfidence).toBe('low')
    expect(out.suppressionReason).toBeUndefined()
  })

  it('soft mode (local ON): allows confirm but caps high → medium and adds caveat', () => {
    const out = enforceCandidateOnlyReevaluation(
      baseResult({ action: 'confirm', revisedConfidence: 'high' }),
      [candidateMatch],
      true,
    )
    expect(out.action).toBe('confirm')
    expect(out.revisedConfidence).toBe('medium')
    expect(out.concerns.some(c => /candidate-only/i.test(c))).toBe(true)
  })

  it('soft mode (local ON): leaves medium confirm as medium', () => {
    const out = enforceCandidateOnlyReevaluation(
      baseResult({ action: 'confirm', revisedConfidence: 'medium' }),
      [candidateMatch],
      true,
    )
    expect(out.action).toBe('confirm')
    expect(out.revisedConfidence).toBe('medium')
  })

  it('soft mode (local ON): maps suppress → downgrade/low', () => {
    const out = enforceCandidateOnlyReevaluation(
      baseResult({ action: 'suppress', revisedConfidence: 'medium', suppressionReason: 'nope' }),
      [candidateMatch],
      true,
    )
    expect(out.action).toBe('downgrade')
    expect(out.revisedConfidence).toBe('low')
    expect(out.suppressionReason).toBeUndefined()
  })

  it('does not alter non-candidate-only evidence', () => {
    const input = baseResult({ action: 'confirm', revisedConfidence: 'high' })
    const out = enforceCandidateOnlyReevaluation(input, [adjudicatedMatch], true)
    expect(out).toEqual(input)
  })
})
