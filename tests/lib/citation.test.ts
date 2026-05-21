import { describe, it, expect } from 'vitest'
import { buildCitationString, buildBibtexCitation, buildRecommendationCitationString } from '@/lib/citation'
import type { AnalysisMetadata, Recommendation } from '@/lib/types'

const baseMeta: AnalysisMetadata = {
  gcaiVersion: '0.6.0',
  generatedAt: '2026-05-21T10:00:00Z',
  methodologyVersion: '2',
}

describe('buildCitationString', () => {
  it('includes version and ISO date', () => {
    const result = buildCitationString(baseMeta)
    expect(result).toContain('v0.6.0')
    expect(result).toContain('2026-05-21T10:00:00.000Z')
  })

  it('uses "unknown date" when generatedAt is absent', () => {
    const meta = { ...baseMeta, generatedAt: '' }
    const result = buildCitationString(meta)
    expect(result).toContain('unknown date')
  })

  it('matches the expected format', () => {
    const result = buildCitationString(baseMeta)
    expect(result).toBe('GreenChemistry.ai v0.6.0, analysis generated 2026-05-21T10:00:00.000Z.')
  })
})

describe('buildBibtexCitation', () => {
  it('includes version and year', () => {
    const result = buildBibtexCitation(baseMeta)
    expect(result).toContain('0.6.0')
    expect(result).toContain('2026')
  })

  it('uses analysisId as key prefix when provided', () => {
    const result = buildBibtexCitation(baseMeta, 'abc12345-xyz')
    expect(result).toContain('@software{gcai-abc12345')
  })

  it('falls back to year-based key when no analysisId', () => {
    const result = buildBibtexCitation(baseMeta)
    expect(result).toContain('@software{gcai-2026')
  })

  it('includes the canonical URL', () => {
    const result = buildBibtexCitation(baseMeta)
    expect(result).toContain('https://greenchemistry.ai')
  })
})

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
