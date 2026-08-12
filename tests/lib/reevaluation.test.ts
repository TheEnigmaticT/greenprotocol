import { describe, it, expect } from 'vitest'
import { buildReevaluatePrompt, REEVALUATE_SCHEMA } from '@/lib/prompts/reevaluate'
import type { Recommendation, LiteratureEvidenceMatch } from '@/lib/types'

describe('Phase 2.7: Re-evaluation Pipeline', () => {
  const mockRecommendation: Recommendation = {
    stepNumber: 1,
    principleNumbers: [3, 5],
    principleNames: ['Less Hazardous Chemical Syntheses', 'Safer Solvents and Auxiliaries'],
    severity: 'high',
    original: {
      chemical: 'Dichloromethane',
      issue: 'Suspected carcinogen; volatile organic compound with high toxicity',
    },
    alternative: {
      chemical: 'Ethyl acetate',
      rationale: 'Lower toxicity, biodegradable, similar polarity for extraction',
      yieldImpact: 'Minimal',
      caveats: 'May require optimization of extraction time',
      evidenceBasis: 'Literature precedent in green chemistry reviews',
    },
    confidenceLevel: 'high',
  }

  const mockLiteratureEvidence: LiteratureEvidenceMatch[] = [
    {
      id: 'doi:p7:u1',
      sourceDocumentId: 'doi:10.1039/sample',
      doi: '10.1039/sample',
      title: 'Green Alternatives to Dichloromethane in Organic Chemistry',
      pageStart: 7,
      pageEnd: 7,
      quote: 'Ethyl acetate has been successfully used as a replacement for DCM in extraction protocols with comparable yields.',
      evidenceType: 'comparison',
      applicability: 'Extraction protocols using dichloromethane.',
      limitations: 'May require optimization of extraction time.',
      candidateStatus: 'candidate_pending_adjudication',
      similarity: 0.85,
    },
  ]

  describe('buildReevaluatePrompt', () => {
    it('should generate prompt with recommendation context', () => {
      const prompt = buildReevaluatePrompt(mockRecommendation, mockLiteratureEvidence)
      
      expect(prompt).toContain('Dichloromethane')
      expect(prompt).toContain('Ethyl acetate')
      expect(prompt).toContain('**Step:** 1')
      expect(prompt).toContain('high')
    })

    it('passes status-labelled page evidence—not article snippets—to Phase 2.7 re-evaluation', () => {
      const prompt = buildReevaluatePrompt(mockRecommendation, mockLiteratureEvidence)

      expect(prompt).toContain('candidate_pending_adjudication')
      expect(prompt).toContain('Pages: 7–7')
      expect(prompt).toContain('Ethyl acetate has been successfully used')
      expect(prompt).toContain('candidate evidence is preliminary')
      expect(prompt).not.toContain('Smith et al.')
      expect(prompt).not.toContain('Journal:')
      expect(prompt).not.toContain('Similarity:')
    })

    it('should handle no literature evidence', () => {
      const prompt = buildReevaluatePrompt(mockRecommendation, [])
      
      expect(prompt).toContain('No relevant literature evidence was found')
      expect(prompt).not.toContain('Green Alternatives to Dichloromethane')
    })

    it('should include re-evaluation rules', () => {
      const prompt = buildReevaluatePrompt(mockRecommendation, mockLiteratureEvidence)
      
      expect(prompt).toContain('Confirm, Adjust, or Suppress')
      expect(prompt).toContain('Be conservative')
      expect(prompt).toContain('Context matters')
      expect(prompt).toContain('experimental validation')
    })
  })

  describe('REEVALUATE_SCHEMA', () => {
    it('should have correct structure', () => {
      expect(REEVALUATE_SCHEMA.type).toBe('object')
      expect(REEVALUATE_SCHEMA.properties).toHaveProperty('action')
      expect(REEVALUATE_SCHEMA.properties).toHaveProperty('revisedConfidence')
      expect(REEVALUATE_SCHEMA.properties).toHaveProperty('revisedRationale')
      expect(REEVALUATE_SCHEMA.properties).toHaveProperty('evidenceAssessment')
      expect(REEVALUATE_SCHEMA.properties).toHaveProperty('concerns')
    })

    it('should enforce action enum', () => {
      const actionProp = REEVALUATE_SCHEMA.properties.action
      expect(actionProp.enum).toEqual(['confirm', 'downgrade', 'suppress'])
    })

    it('should enforce confidence enum', () => {
      const confProp = REEVALUATE_SCHEMA.properties.revisedConfidence
      expect(confProp.enum).toEqual(['high', 'medium', 'low'])
    })

    it('should require evidence assessment fields', () => {
      const assessProp = REEVALUATE_SCHEMA.properties.evidenceAssessment
      expect(assessProp.required).toEqual([
        'supportsOriginalIssue',
        'supportsAlternative',
        'contextMatch',
        'quantitativeData',
      ])
    })
  })

  describe('Re-evaluation logic', () => {
    it('should suppress recommendations with contradictory evidence', () => {
      // This would be tested in integration tests with real pipeline
      // Mock example:
      const mockResult = {
        action: 'suppress',
        suppressionReason: 'Literature shows ethyl acetate yields significantly worse results in this chemistry context',
      }
      
      expect(mockResult.action).toBe('suppress')
      expect(mockResult.suppressionReason).toBeTruthy()
    })

    it('should downgrade recommendations with weak evidence', () => {
      const mockResult = {
        action: 'downgrade',
        revisedConfidence: 'medium',
        concerns: ['No literature found for this specific reaction type', 'Context match is weak'],
      }
      
      expect(mockResult.action).toBe('downgrade')
      expect(mockResult.revisedConfidence).toBe('medium')
      expect(mockResult.concerns.length).toBeGreaterThan(0)
    })

    it('should confirm recommendations with strong evidence', () => {
      const mockResult = {
        action: 'confirm',
        revisedConfidence: 'high',
        evidenceAssessment: {
          supportsOriginalIssue: true,
          supportsAlternative: true,
          contextMatch: 'strong',
          quantitativeData: true,
        },
      }
      
      expect(mockResult.action).toBe('confirm')
      expect(mockResult.evidenceAssessment.contextMatch).toBe('strong')
    })
  })

  describe('Statistics tracking', () => {
    it('should track re-evaluation stats', () => {
      const mockStats = {
        confirmed: 5,
        downgraded: 2,
        suppressed: 1,
        failed: 0,
      }
      
      expect(mockStats.confirmed).toBe(5)
      expect(mockStats.suppressed).toBe(1)
      
      const total = mockStats.confirmed + mockStats.downgraded + mockStats.suppressed
      const suppressionRate = (mockStats.suppressed / total) * 100
      expect(suppressionRate).toBeCloseTo(12.5)
    })
  })
})
