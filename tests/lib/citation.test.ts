import { describe, it, expect } from 'vitest'
import { buildRecommendationCitationString } from '@/lib/citation'
import type { Recommendation } from '@/lib/types'

const baseRec: Recommendation = {
  stepNumber: 3,
  principleNumbers: [5],
  principleNames: ['Safer Solvents'],
  severity: 'high',
  original: { chemical: 'DMF', issue: 'toxic solvent' },
  alternative: { chemical: 'DMSO', rationale: 'lower toxicity', yieldImpact: 'none', caveats: '', evidenceBasis: '' },
  confidenceLevel: 'high',
  citationMetadata: { gcaiVersion: '0.6.0', generatedAt: '2026-05-21T10:00:00Z' },
}

describe('buildRecommendationCitationString', () => {
  it('includes chemical names and step number', () => {
    const result = buildRecommendationCitationString(baseRec)
    expect(result).toContain('DMF')
    expect(result).toContain('DMSO')
    expect(result).toContain('Step 3')
  })

  it('includes version from citationMetadata', () => {
    const result = buildRecommendationCitationString(baseRec)
    expect(result).toContain('v0.6.0')
  })

  it('includes analysisId when provided', () => {
    const result = buildRecommendationCitationString(baseRec, 'abc-123')
    expect(result).toContain('abc-123')
  })

  it('omits analysis ID section when not provided', () => {
    const result = buildRecommendationCitationString(baseRec)
    expect(result).not.toContain('Analysis ID')
  })
})
