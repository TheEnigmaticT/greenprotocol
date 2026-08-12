import { describe, expect, it } from 'vitest'
import { buildTalkAboutContext, parseTalkAboutScope } from '@/lib/talk-about-this/context'
import type { AnalysisResult } from '@/lib/types'

const analysis: AnalysisResult = {
  protocolTitle: 'Amide coupling',
  chemistrySubdomain: 'Organic synthesis',
  steps: [{
    stepNumber: 1,
    description: 'Couple acid and amine in DMF.',
    chemicals: [{ name: 'DMF', role: 'solvent', quantity: '10 mL', quantityMl: 10, quantityKg: null }],
    conditions: { temperature: '25 C', duration: '2 h', atmosphere: null },
  }],
  recommendations: [{
    id: 'rec-1',
    stepNumber: 1,
    principleNumbers: [5],
    principleNames: ['Safer Solvents'],
    severity: 'high',
    original: { chemical: 'DMF', issue: 'Reprotoxic solvent' },
    alternative: {
      chemical: '2-MeTHF',
      rationale: 'A preferred solvent class.',
      yieldImpact: 'Validate experimentally.',
      caveats: 'Check solubility.',
      evidenceBasis: 'Literature',
    },
    confidenceLevel: 'medium',
    evidence: {
      why_flagged: [],
      why_replacement: [],
      citations: [{ source_id: 'doi:10.1/test', source_name: 'Test source', citation: 'Test et al.', doi: '10.1/test' }],
    },
  }],
  revisedProtocol: 'Use 2-MeTHF.',
  overallAssessment: {
    greenPrinciplesViolated: [5],
    mostImpactfulChange: 'Replace DMF.',
    experimentalValidationNeeded: true,
    disclaimer: 'Validate experimentally.',
  },
}

describe('buildTalkAboutContext', () => {
  it('builds a bounded recommendation context and resolves only its evidence', () => {
    const context = buildTalkAboutContext({
      analysisId: 'analysis-1',
      protocolText: 'Couple acid and amine in DMF.',
      analysis,
      scope: { kind: 'recommendation', recommendationId: 'rec-1' },
    })

    expect(context.scope).toEqual({ kind: 'recommendation', recommendationId: 'rec-1' })
    expect(context.recommendations).toHaveLength(1)
    expect(context.steps).toEqual([analysis.steps[0]])
    expect(context.citations).toEqual([expect.objectContaining({ id: 'doi:10.1/test' })])
    expect(context.noDirectEvidence).toBe(false)
    expect(context.contextHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('resolves a legacy recommendation without an ID by its frozen index', () => {
    const legacyAnalysis = {
      ...analysis,
      recommendations: analysis.recommendations.map(({ id: _id, ...recommendation }) => recommendation),
    }

    expect(parseTalkAboutScope({ kind: 'recommendation', recommendationIndex: 0 }))
      .toEqual({ kind: 'recommendation', recommendationIndex: 0, readOnly: true })

    const context = buildTalkAboutContext({
      analysisId: 'analysis-legacy',
      protocolText: 'Couple acid and amine in DMF.',
      analysis: legacyAnalysis,
      scope: { kind: 'recommendation', recommendationIndex: 0 },
    })

    expect(context.scope).toEqual({ kind: 'recommendation', recommendationIndex: 0 })
    expect(context.recommendations).toHaveLength(1)
  })

  it('rejects scopes that do not resolve to this frozen analysis', () => {
    expect(() => buildTalkAboutContext({
      analysisId: 'analysis-1',
      protocolText: 'Couple acid and amine in DMF.',
      analysis,
      scope: { kind: 'recommendation', recommendationId: 'rec-missing' },
    })).toThrow('Recommendation scope does not match exactly one recommendation in this analysis')
  })
})
