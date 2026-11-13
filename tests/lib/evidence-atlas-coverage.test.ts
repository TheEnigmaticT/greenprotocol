import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import EvidenceAtlas from '@/components/EvidenceAtlas'
import type { AnalysisResult } from '@/lib/types'

function analysis(overrides: Partial<AnalysisResult>): AnalysisResult {
  return {
    protocolTitle: 'Example protocol',
    chemistrySubdomain: 'Organic synthesis',
    steps: [],
    recommendations: [],
    revisedProtocol: '',
    overallAssessment: {
      greenPrinciplesViolated: [],
      mostImpactfulChange: '',
      experimentalValidationNeeded: false,
      disclaimer: '',
    },
    deterministicScores: {
      scores: [],
      total_score: 0,
      max_possible: 0,
      grade: 'C',
      smiles_extraction: {},
      yield_extraction: {},
    },
    ...overrides,
  } as AnalysisResult
}

function markup(a: AnalysisResult) {
  return renderToStaticMarkup(createElement(EvidenceAtlas, {
    analysisId: 'fake-id',
    analysis: a,
    embedded: true, // avoid AppShell to keep test output focused
  }))
}

describe('EvidenceAtlas truthful coverage / role boundary', () => {
  it('does not pretend a partial coverage grade is comparable to a complete grade', () => {
    const a = analysis({
      deterministicScores: {
        scores: [
          { principle_number: 1, principle_name: 'Prevention', score: 4, max_score: 10, normalized: 0.4, details: {}, chemicals_flagged: [], data_sources: [], confidence: 'calculated' },
          { principle_number: 2, principle_name: 'Atom Economy', score: 5, max_score: 10, normalized: 0.5, details: {}, chemicals_flagged: [], data_sources: [], confidence: 'calculated' },
          { principle_number: 5, principle_name: 'Safer Solvents', score: 6, max_score: 10, normalized: 0.6, details: {}, chemicals_flagged: ['hexane'], data_sources: ['chem21'], confidence: 'model-inferred' },
          { principle_number: 7, principle_name: 'Renewable Feedstocks', score: -1, max_score: 10, normalized: -1, details: { error: 'missing data' }, chemicals_flagged: [], data_sources: [], confidence: 'unavailable' },
        ],
        total_score: 15,
        max_possible: 40,
        grade: 'INCOMPLETE',
        smiles_extraction: {},
        yield_extraction: {},
      },
    })
    const html = markup(a)

    // Quiet grade line / header must reflect INCOMPLETE
    expect(html).toMatch(/INCOMPLETE|incomplete/i)
    // Footer methodology block must reflect partial coverage
    expect(html).toMatch(/3.*of.*4|3.*principles scored/i)
  })

  it('renders unavailable scores as N/A in the principles index, not as 0.0', () => {
    const a = analysis({
      deterministicScores: {
        scores: [
          { principle_number: 1, principle_name: 'Prevention', score: 4, max_score: 10, normalized: 0.4, details: {}, chemicals_flagged: [], data_sources: [], confidence: 'calculated' },
          { principle_number: 7, principle_name: 'Renewable Feedstocks', score: -1, max_score: 10, normalized: -1, details: { error: 'missing' }, chemicals_flagged: [], data_sources: [], confidence: 'unavailable' },
        ],
        total_score: 4,
        max_possible: 20,
        grade: 'INCOMPLETE',
        smiles_extraction: {},
        yield_extraction: {},
      },
    })
    const html = markup(a)

    // P7 row in the index should show N/A, not 0.0
    const p7Match = html.match(/P7[\s\S]{0,500}/)
    expect(p7Match).not.toBeNull()
    const p7Slice = p7Match![0]
    expect(p7Slice).toMatch(/N\/A/i)
    expect(p7Slice).not.toMatch(/>0\.0</)
  })

  it('respects role-aware solvent/use boundary: a workup chemical is not labelled as solvent on a non-solvent principle', () => {
    // P8 (Reduce Derivatives) — flagged chemical is sodium triacetoxyborohydride (a reagent),
    // not a solvent. The atlas must not blanket-render it under a solvent label.
    const a = analysis({
      deterministicScores: {
        scores: [
          { principle_number: 8, principle_name: 'Reduce Derivatives', score: 4, max_score: 10, normalized: 0.4, details: {}, chemicals_flagged: ['sodium triacetoxyborohydride'], data_sources: [], confidence: 'calculated' },
        ],
        total_score: 4,
        max_possible: 10,
        grade: 'C',
        smiles_extraction: {},
        yield_extraction: {},
      },
    })
    const html = markup(a)

    // The chemical appears in flagged list, but no solvent label applied to it
    expect(html).toContain('sodium triacetoxyborohydride')
    // We must not see "Solvent" labelling for P8's flagged reagent in this context
    expect(html).not.toMatch(/P8[\s\S]{0,400}solvent/i)
  })
})
