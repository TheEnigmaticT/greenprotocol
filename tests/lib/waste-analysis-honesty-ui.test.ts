import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PrincipleSection from '@/components/PrincipleSection'
import WasteScoreCard from '@/components/WasteScoreCard'
import type { WasteAnalysis } from '@/lib/types'

const unavailableWasteAnalysis = {
  version: 'waste-analysis/v2',
  availability: {
    actualWasteMass: 'unavailable',
    liquidDisposition: 'unavailable',
    reason: 'Actual waste generation and liquid disposition were not reported in the submitted protocol.',
  },
  summary: {
    wasteImpactScore: -1,
    grade: 'unavailable',
    primaryDriver: 'Actual waste generation is unknown.',
    bestNextAction: 'Record waste streams and disposition to estimate waste.',
    confidence: 'unavailable',
  },
  observedInputInventory: {
    knownInputMassKg: 1,
    knownMassChemicalCount: 2,
    chemicalsWithUnknownMassCount: 1,
    massCoverage: 'partial',
  },
  directWaste: { totalWasteKg: null, solventWasteKg: null, nonSolventWasteKg: null },
  hazardSegments: [{
    category: 'toxic', totalKg: null, chemicalsCount: 1, chemicals: ['unmeasured toxic'], massCoverage: 'unavailable',
  }],
  liquidBurden: { totalLiquidHandledKg: null, totalLiquidDiscardedKg: null },
  processBurden: { transferCount: 1, vesselCount: 1, purificationCount: 0, washStepCount: 0, workflowComplexity: 1 },
  upstream: { lcaAvailable: false, notes: 'Upstream LCA data not yet integrated.' },
  evidenceSources: ['GHS PUG-View H-codes', 'Process complexity analysis'],
} as unknown as WasteAnalysis

describe('waste analysis availability UI', () => {
  it('does not render unknown waste as a grade, score, or zero-valued waste metric in card consumers', () => {
    const cardMarkup = renderToStaticMarkup(createElement(WasteScoreCard, { wasteAnalysis: unavailableWasteAnalysis }))
    const principleMarkup = renderToStaticMarkup(createElement(PrincipleSection, {
      principleNumber: 1,
      principleName: 'Prevention',
      recommendations: [],
      wasteAnalysis: unavailableWasteAnalysis,
    }))

    for (const markup of [cardMarkup, principleMarkup]) {
      expect(markup).toContain('Waste estimate unavailable')
      expect(markup).toContain('Actual waste generation is unknown.')
      expect(markup).not.toContain('Liquid discarded kg')
      expect(markup).not.toContain('Total kg')
      expect(markup).not.toContain('Waste Impact: -1/10')
    }
    expect(cardMarkup).not.toContain('>-1/10<')
    expect(principleMarkup).toContain('Observed input inventory')
    expect(principleMarkup).toContain('1.000 kg')
    expect(principleMarkup).toContain('Hazard flags (not waste quantities)')
    expect(principleMarkup).toContain('unmeasured toxic')
  })

  it('withholds a legacy numeric payload because it has no waste-availability boundary', () => {
    const legacy = {
      ...unavailableWasteAnalysis,
      version: undefined,
      availability: undefined,
      summary: { ...unavailableWasteAnalysis.summary, wasteImpactScore: 2, grade: 'A', confidence: 'calculated' },
      directWaste: { totalWasteKg: 1, solventWasteKg: 0.8, nonSolventWasteKg: 0.2 },
    } as unknown as WasteAnalysis

    const markup = renderToStaticMarkup(createElement(WasteScoreCard, { wasteAnalysis: legacy }))

    expect(markup).toContain('Waste estimate unavailable')
    expect(markup).not.toContain('>2/10<')
    expect(markup).not.toContain('>A<')
  })
})
