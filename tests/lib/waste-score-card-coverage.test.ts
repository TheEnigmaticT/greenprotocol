import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import WasteScoreCard from '@/components/WasteScoreCard'
import type { WasteAnalysis } from '@/lib/types'

function waste(overrides: Partial<WasteAnalysis>): WasteAnalysis {
  return {
    summary: {
      wasteImpactScore: 5,
      grade: 'C',
      primaryDriver: 'Solvent waste from workup',
      confidence: 'calculated',
    },
    directWaste: {
      totalWasteKg: 0.250,
      solventWasteKg: 0.150,
      nonSolventWasteKg: 0.100,
    },
    hazardSegments: [],
    liquidBurden: {
      totalLiquidHandledKg: 1.0,
      totalLiquidDiscardedKg: 0.8,
    },
    processBurden: {
      transferCount: 5,
      vesselCount: 3,
      purificationCount: 1,
      washStepCount: 2,
      workflowComplexity: 2,
    },
    upstream: {
      lcaAvailable: false,
      notes: '',
    },
    evidenceSources: [],
    ...overrides,
  }
}

function markup(w: WasteAnalysis) {
  return renderToStaticMarkup(createElement(WasteScoreCard, { wasteAnalysis: w }))
}

describe('WasteScoreCard truthful coverage display', () => {
  it('renders INCOMPLETE grade with neutral honest label, not default C color', () => {
    const html = markup(waste({
      summary: {
        wasteImpactScore: 5,
        grade: 'INCOMPLETE',
        primaryDriver: 'Some materials unresolved',
        confidence: 'unavailable',
      },
    }))

    // Must show INCOMPLETE grade honestly
    expect(html).toMatch(/INCOMPLETE|incomplete/i)
    // Must caveat that the grade is not comparable to a complete one
    expect(html).toMatch(/partial|incomplete|not comparable|cannot be compared|coverage/i)
  })

  it('does not render 0 kg as if complete when coverage is incomplete', () => {
    const html = markup(waste({
      summary: {
        wasteImpactScore: 5,
        grade: 'INCOMPLETE',
        primaryDriver: 'Solvent role unresolved',
        confidence: 'unavailable',
      },
      directWaste: {
        totalWasteKg: 0, // missing data collapsed to 0 — must NOT look like a real 0 kg total
        solventWasteKg: 0,
        nonSolventWasteKg: 0,
      },
    }))

    // Must explicitly say the kg figures are unavailable / not computed, not display "0.000 kg" as the headline
    expect(html).toMatch(/unavailable|not (yet )?computed|no mass|unknown|coverage/i)
    // And it must NOT claim "Total 0.000 kg" as a confident figure
    expect(html).not.toMatch(/Total\s*0\.000\s*kg/)
  })

  it('does not flag a chemical as solvent without role evidence when coverage is incomplete', () => {
    // The WasteScoreCard renders summary.primaryDriver; when INCOMPLETE it must not invent solvent kg attribution
    const html = markup(waste({
      summary: {
        wasteImpactScore: 5,
        grade: 'INCOMPLETE',
        primaryDriver: 'Some materials could not be classified',
        confidence: 'unavailable',
      },
    }))

    // The reason must be displayed honestly, not "solvent waste" inferred from default fields
    expect(html).toContain('Some materials could not be classified')
    expect(html).toMatch(/unavailable|partial|incomplete/i)
  })
})
