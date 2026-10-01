import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AnalysisCard from '@/components/AnalysisCard'
import type { AnalysisSummary, ImpactDelta } from '@/lib/types'

const analysis = (impact: ImpactDelta | null): AnalysisSummary => ({
  id: 'saved-scisure-analysis', protocol_text: 'Reviewed source',
  analysis_result: { protocolTitle: 'Saved SciSure protocol', chemistrySubdomain: 'Coordination chemistry', recommendations: [] },
  impact_delta: impact, created_at: '2026-10-01T18:29:46Z',
})

describe('dashboard analysis card with missing impact data', () => {
  it('renders a SciSure record without throwing or fabricating savings', () => {
    const html = renderToStaticMarkup(createElement(AnalysisCard, { analysis: analysis(null) }))
    expect(html).toContain('Saved SciSure protocol')
    expect(html).toContain('href="/analyze/saved-scisure-analysis"')
    expect(html).toContain('Impact not calculated')
    expect(html).not.toContain('kg CO2e')
    expect(html).not.toContain('kg waste')
  })
  it('preserves calculated savings when impact data exists', () => {
    const impact = { co2eSavedKg: 2, hazardousWasteEliminatedKg: 1 } as ImpactDelta
    const html = renderToStaticMarkup(createElement(AnalysisCard, { analysis: analysis(impact) }))
    expect(html).toContain('-2.0 kg CO2e')
    expect(html).toContain('-1.0 kg waste')
    expect(html).not.toContain('Impact not calculated')
  })
})
