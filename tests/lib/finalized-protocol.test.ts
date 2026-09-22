import { describe, expect, it } from 'vitest'
import { buildFinalizedProtocol, canApplyAcceptedRecommendation } from '@/lib/finalized-protocol'
import type { AnalysisResult, Recommendation, RecommendationEvidenceAssessment } from '@/lib/types'

function assessment(disposition: RecommendationEvidenceAssessment['disposition']): RecommendationEvidenceAssessment {
  return {
    disposition,
    directness: disposition === 'supported_applicable' || disposition === 'supported_with_constraints' ? 'direct' : disposition === 'analogous_only' ? 'indirect' : 'none',
    supportingReferenceCount: disposition === 'insufficient_evidence' ? 0 : 1,
    applicability: disposition === 'supported_applicable' ? 'strong' : disposition === 'supported_with_constraints' ? 'partial' : 'weak',
    eligibleForApplication: disposition === 'supported_applicable',
    eligibilityReason: 'test',
  }
}

function rec(overrides: Partial<Recommendation> = {}, disposition?: RecommendationEvidenceAssessment['disposition']): Recommendation {
  return {
    stepNumber: 1,
    principleNumbers: [5],
    principleNames: ['Safer Solvents and Auxiliaries'],
    severity: 'medium',
    original: { chemical: 'Dichloromethane', issue: 'Hazardous solvent' },
    alternative: {
      chemical: 'Ethyl acetate',
      rationale: 'Greener alternative',
      yieldImpact: 'Similar',
      caveats: 'Validate',
      evidenceBasis: 'Literature',
    },
    confidenceLevel: 'medium',
    isAccepted: true,
    evidenceAssessment: disposition ? assessment(disposition) : undefined,
    ...overrides,
  }
}

describe('canApplyAcceptedRecommendation', () => {
  it('allows supported_applicable when accepted', () => {
    expect(canApplyAcceptedRecommendation(rec({}, 'supported_applicable'))).toBe(true)
  })

  it('allows supported_with_constraints only after explicit acceptance', () => {
    expect(canApplyAcceptedRecommendation(rec({ isAccepted: true }, 'supported_with_constraints'))).toBe(true)
    expect(canApplyAcceptedRecommendation(rec({ isAccepted: false }, 'supported_with_constraints'))).toBe(false)
  })

  it('never applies analogous_only or insufficient_evidence even when accepted', () => {
    expect(canApplyAcceptedRecommendation(rec({}, 'analogous_only'))).toBe(false)
    expect(canApplyAcceptedRecommendation(rec({}, 'insufficient_evidence'))).toBe(false)
  })
})

describe('buildFinalizedProtocol', () => {
  it('does not rewrite procedure text from accepted analogous_only hypotheses', () => {
    const analysis: AnalysisResult = {
      protocolTitle: 'Demo',
      chemistrySubdomain: 'organic',
      steps: [{
        stepNumber: 1,
        description: 'Extract with Dichloromethane.',
        chemicals: [],
        conditions: { temperature: null, duration: null, atmosphere: null },
      }],
      recommendations: [rec({}, 'analogous_only')],
      revisedProtocol: 'Extract with Ethyl acetate.',
      overallAssessment: {
        greenPrinciplesViolated: [5],
        mostImpactfulChange: 'none',
        experimentalValidationNeeded: true,
        disclaimer: 'test',
      },
    }
    const finalized = buildFinalizedProtocol(analysis, 'Extract with Dichloromethane.')
    expect(finalized).toContain('Dichloromethane')
    expect(finalized).not.toContain('Ethyl acetate')
  })

  it('rewrites procedure text for accepted supported_applicable recommendations', () => {
    const analysis: AnalysisResult = {
      protocolTitle: 'Demo',
      chemistrySubdomain: 'organic',
      steps: [{
        stepNumber: 1,
        description: 'Extract with Dichloromethane.',
        chemicals: [],
        conditions: { temperature: null, duration: null, atmosphere: null },
      }],
      recommendations: [rec({}, 'supported_applicable')],
      revisedProtocol: '',
      overallAssessment: {
        greenPrinciplesViolated: [5],
        mostImpactfulChange: 'swap',
        experimentalValidationNeeded: true,
        disclaimer: 'test',
      },
    }
    const finalized = buildFinalizedProtocol(analysis, 'Extract with Dichloromethane.')
    expect(finalized).toContain('Ethyl acetate')
  })
})
