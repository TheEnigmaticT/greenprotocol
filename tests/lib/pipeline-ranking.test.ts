import { describe, it, expect } from 'vitest'
import { deriveEvidenceTier, rankRecommendations } from '@/lib/pipeline'
import type { Recommendation } from '@/lib/types'

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
