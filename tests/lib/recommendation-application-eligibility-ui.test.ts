import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AnalysisResults from '@/components/AnalysisResults'
import FinalizedProtocol from '@/components/FinalizedProtocol'
import PrincipleSection from '@/components/PrincipleSection'
import type { AnalysisResult, Recommendation } from '@/lib/types'

function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    stepNumber: 1,
    principleNumbers: [5],
    principleNames: ['Safer solvents and auxiliaries'],
    severity: 'high',
    kind: 'chemical_swap',
    original: { chemical: '2-MeTHF', issue: 'Peroxide formation concern.' },
    alternative: {
      chemical: 'Cyclopentyl methyl ether',
      rationale: 'Candidate solvent replacement.',
      yieldImpact: 'Unknown.',
      caveats: 'Validate experimentally.',
      evidenceBasis: 'Candidate screening only.',
    },
    confidenceLevel: 'medium',
    primaryBenefit: 'Removes peroxide-forming solvent',
    ...overrides,
  }
}

function analysis(recommendations: Recommendation[]): AnalysisResult {
  return {
    protocolTitle: 'Eligibility fixture',
    chemistrySubdomain: 'Synthetic chemistry',
    steps: [{
      stepNumber: 1,
      description: 'Use 2-MeTHF.',
      chemicals: [],
      conditions: { temperature: null, duration: null, atmosphere: null },
    }],
    recommendations,
    revisedProtocol: 'Use Cyclopentyl methyl ether.',
    overallAssessment: {
      greenPrinciplesViolated: [5],
      mostImpactfulChange: 'Replace solvent.',
      experimentalValidationNeeded: true,
      disclaimer: 'Validate experimentally.',
    },
  }
}

describe('recommendation application eligibility UI', () => {
  it('withholds a hypothesis-only swap from every visible application surface', () => {
    const unsupported = recommendation({
      applicationEligibility: {
        status: 'hypothesis_only',
        reason: 'No reaction-specific literature evidence was retrieved for this substitution.',
      },
    })
    const result = analysis([unsupported])

    const resultsMarkup = renderToStaticMarkup(createElement(AnalysisResults, {
      analysis: result,
      originalProtocol: 'Use 2-MeTHF.',
      onUpdateAnalysis: () => {},
    }))
    const finalizedMarkup = renderToStaticMarkup(createElement(FinalizedProtocol, {
      analysis: result,
      originalProtocol: 'Use 2-MeTHF.',
      onUpdateAnalysis: () => {},
    }))
    const principleMarkup = renderToStaticMarkup(createElement(PrincipleSection, {
      principleNumber: 5,
      principleName: 'Safer solvents and auxiliaries',
      recommendations: [unsupported],
    }))

    for (const markup of [resultsMarkup, finalizedMarkup, principleMarkup]) {
      expect(markup).toContain('Not eligible for protocol application')
      expect(markup).toContain('No reaction-specific literature evidence was retrieved for this substitution.')
    }
    expect(resultsMarkup).not.toContain('Accept Solution')
    expect(resultsMarkup).not.toContain('Accept all HIGH severity')
    expect(finalizedMarkup).not.toContain('>Accept<')
    expect(principleMarkup).toContain('Candidate benefit (unconfirmed)')
  })

  it('labels an old accepted unsupported swap as withheld rather than adopted', () => {
    const staleAccepted = recommendation({
      isAccepted: true,
      applicationEligibility: {
        status: 'unavailable',
        reason: 'Literature re-evaluation was unavailable, so this substitution cannot be applied.',
      },
    })
    const result = analysis([staleAccepted])
    const markup = renderToStaticMarkup(createElement(FinalizedProtocol, {
      analysis: result,
      originalProtocol: 'Use 2-MeTHF.',
      onUpdateAnalysis: () => {},
    }))

    expect(markup).toContain('Accepted review decisions · 1')
    expect(markup).toContain('Withheld — not adopted')
    expect(markup).toContain('Not eligible for protocol application')
    expect(markup).not.toContain('Finished Lab Procedure')
    expect(markup).not.toContain('Use Cyclopentyl methyl ether.')
  })

  it('identifies a swap with no recorded evidence gate as ineligible rather than assuming support', () => {
    const missingGate = recommendation()
    const markup = renderToStaticMarkup(createElement(AnalysisResults, {
      analysis: analysis([missingGate]),
      originalProtocol: 'Use 2-MeTHF.',
      onUpdateAnalysis: () => {},
    }))

    expect(markup).toContain('Not eligible for protocol application')
    expect(markup).toContain('Evidence gate incomplete')
    expect(markup).toContain('Reaction-applicable evidence has not been recorded')
    expect(markup).not.toContain('Accept Solution')
  })

  it('keeps supported swaps and non-swap review actions available', () => {
    const supported = recommendation({
      applicationEligibility: { status: 'supported', reason: 'Reaction-applicable evidence supports this substitution.' },
    })
    const processTip = recommendation({
      kind: 'process_change',
      original: { chemical: 'Reaction', issue: 'Excess heat.' },
      alternative: { chemical: 'Run at ambient temperature.', rationale: 'Lower energy demand.', yieldImpact: 'Validate.', caveats: '', evidenceBasis: '' },
      applicationEligibility: undefined,
    })

    const markup = renderToStaticMarkup(createElement(FinalizedProtocol, {
      analysis: analysis([supported, processTip]),
      originalProtocol: 'Use 2-MeTHF.',
      onUpdateAnalysis: () => {},
    }))

    expect(markup.match(/>Accept</g)).toHaveLength(2)
    expect(markup.match(/>Reject</g)).toHaveLength(2)
  })
})
