import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import FinalizedProtocol from '@/components/FinalizedProtocol'
import type { AnalysisResult } from '@/lib/types'

function makeAnalysis(isAccepted?: boolean): AnalysisResult {
  return {
    protocolTitle: 'Solvent replacement procedure',
    chemistrySubdomain: 'Organic synthesis',
    steps: [{
      stepNumber: 1,
      description: 'Charge DMF and stir for one hour.',
      chemicals: [],
      conditions: { temperature: null, duration: 'one hour', atmosphere: null },
    }],
    recommendations: [{
      stepNumber: 1,
      principleNumbers: [5],
      principleNames: ['Safer solvents and auxiliaries'],
      severity: 'high',
      original: { chemical: 'DMF', issue: 'Hazardous solvent.' },
      alternative: {
        chemical: 'Ethyl acetate',
        rationale: 'Lower-hazard alternative.',
        yieldImpact: 'Validate experimentally.',
        caveats: 'Confirm solubility.',
        evidenceBasis: 'Literature evidence.',
      },
      confidenceLevel: 'high',
      isAccepted,
    }],
    revisedProtocol: 'Charge Ethyl acetate and stir for one hour.',
    overallAssessment: {
      greenPrinciplesViolated: [5],
      mostImpactfulChange: 'Replace DMF.',
      experimentalValidationNeeded: true,
      disclaimer: 'Validate experimentally.',
    },
  }
}

describe('FinalizedProtocol', () => {
  it('always shows a copyable and printable procedure workbench before recommendations are reviewed', () => {
    const markup = renderToStaticMarkup(createElement(FinalizedProtocol, {
      analysis: makeAnalysis(),
      originalProtocol: 'Charge DMF and stir for one hour.',
    }))

    expect(markup).toContain('Current Lab Procedure Draft')
    expect(markup).toContain('Charge DMF and stir for one hour.')
    expect(markup).toContain('Copy Procedure')
    expect(markup).toContain('Print Procedure')
  })

  it('shows accepted recommendation edits in the procedure workbench', () => {
    const markup = renderToStaticMarkup(createElement(FinalizedProtocol, {
      analysis: makeAnalysis(true),
      originalProtocol: 'Charge DMF and stir for one hour.',
    }))

    expect(markup).toContain('Charge Ethyl acetate and stir for one hour.')
  })
})
