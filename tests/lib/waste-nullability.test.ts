import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import WasteDetailsPanel from '@/components/WasteDetailsPanel'
import PrincipleSection from '@/components/PrincipleSection'
import type { WasteAnalysis } from '@/lib/types'

const missingWaste: WasteAnalysis = {
  summary: { wasteImpactScore: -1, grade: 'INCOMPLETE', primaryDriver: 'Waste amounts were not reported.', confidence: 'unavailable' },
  directWaste: { totalWasteKg: null, solventWasteKg: null, nonSolventWasteKg: null },
  liquidBurden: { totalLiquidHandledKg: null, totalLiquidDiscardedKg: null },
  hazardSegments: [{ category: 'toxic', totalKg: null, chemicalsCount: 1, chemicals: ['fixture'] }],
  processBurden: { transferCount: 0, vesselCount: 0, purificationCount: 0, washStepCount: 0, workflowComplexity: 0 },
  upstream: { lcaAvailable: false, notes: '' }, evidenceSources: [],
}

describe('nullable waste measurements', () => {
  it('renders missing kg as unavailable rather than a zero/less-than value', () => {
    const html = renderToStaticMarkup(createElement(WasteDetailsPanel, { wasteAnalysis: missingWaste }))
    expect(html).toMatch(/unavailable/i)
    expect(html).not.toMatch(/&lt;0\.01 kg|>0 kg</)
  })
  it('renders the P1 waste panel without crashing or exposing numeric unavailable sentinels', () => {
    const html = renderToStaticMarkup(createElement(PrincipleSection, { principleNumber: 1, principleName: 'Waste prevention', recommendations: [], wasteAnalysis: missingWaste }))
    expect(html).toMatch(/unavailable/i)
    expect(html).not.toContain('-1/10')
    expect(html).not.toMatch(/>0\.000</)
  })
})
