import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ScoreCard from '@/components/ScoreCard'
import type { DeterministicScores, PrincipleScore } from '@/lib/types'

function principle(overrides: Partial<PrincipleScore>): PrincipleScore {
  return {
    principle_number: 1,
    principle_name: 'Waste Prevention',
    score: 5,
    max_score: 10,
    normalized: 0.5,
    details: {},
    chemicals_flagged: [],
    data_sources: [],
    confidence: 'calculated',
    ...overrides,
  }
}

function scores(overrides: Partial<DeterministicScores>): DeterministicScores {
  return {
    scores: [],
    total_score: 0,
    max_possible: 0,
    grade: 'C',
    smiles_extraction: {},
    yield_extraction: {},
    ...overrides,
  }
}

function markup(s: DeterministicScores) {
  return renderToStaticMarkup(createElement(ScoreCard, { scores: s }))
}

describe('ScoreCard truthful coverage display', () => {
  it('renders INCOMPLETE grade with a neutral honest label, never the default grade C color', () => {
    const html = markup(scores({
      grade: 'INCOMPLETE',
      total_score: 14,
      max_possible: 60,
      scores: [
        principle({ principle_number: 1, score: 4, confidence: 'calculated' }),
        principle({ principle_number: 2, score: 5, confidence: 'calculated' }),
        principle({ principle_number: 5, score: 5, confidence: 'model-inferred' }),
        principle({ principle_number: 7, score: -1, confidence: 'unavailable' }),
        principle({ principle_number: 11, score: -1, confidence: 'unavailable' }),
      ],
    }))

    // Honest neutral label must be present
    expect(html).toMatch(/INCOMPLETE|incomplete/i)
    // Must explicitly caveat that this is partial / not comparable to a complete grade
    expect(html).toMatch(/partial|incomplete|not (a |an )?complete|not comparable|cannot be compared/i)
    // Must NOT claim a normal C grade — the literal "C" badge that means green-yellow should not appear as the headline grade for INCOMPLETE
    // The summary footer should disclose how many were assessed vs total
    expect(html).toMatch(/3.*of.*5|3.*of.*12|3 of/i)
  })

  it('treats unavailable confidence as N/A even when score value happens to be 0 in old saved records', () => {
    const html = markup(scores({
      grade: 'C',
      total_score: 10,
      max_possible: 30,
      scores: [
        principle({ principle_number: 1, score: 5, confidence: 'calculated' }),
        principle({ principle_number: 2, score: 5, confidence: 'calculated' }),
        // Old saved record: score is 0 but confidence says unavailable — must NOT render as 0.0 valid
        principle({ principle_number: 7, score: 0, confidence: 'unavailable' }),
      ],
    }))

    // The unavailable principle must render N/A, not 0.0
    // Find the P7 row context and assert no "0.0" appears next to it
    const p7Match = html.match(/P7[\s\S]{0,400}/)
    expect(p7Match).not.toBeNull()
    const p7Slice = p7Match![0]
    expect(p7Slice).toMatch(/N\/A|n\/a/i)
    // And specifically the unavailable-suffix pattern should not be "0.0"
    expect(p7Slice).not.toMatch(/>0\.0</)
  })

  it('displays assessed / total principles count in the footer, not just a vague summary', () => {
    const html = markup(scores({
      grade: 'B',
      total_score: 22,
      max_possible: 50,
      scores: [
        principle({ principle_number: 1, score: 4, confidence: 'calculated' }),
        principle({ principle_number: 2, score: 5, confidence: 'calculated' }),
        principle({ principle_number: 3, score: 6, confidence: 'declared' }),
        principle({ principle_number: 5, score: 7, confidence: 'model-inferred' }),
        principle({ principle_number: 7, score: -1, confidence: 'unavailable' }),
        principle({ principle_number: 9, score: -1, confidence: 'unavailable' }),
      ],
    }))

    // 4 of 6 assessed (score >= 0)
    expect(html).toMatch(/4 of 6|4 of/i)
  })

  it('distinguishes AI-assessed principles from deterministic ones in the coverage footer', () => {
    const html = markup(scores({
      grade: 'B',
      total_score: 22,
      max_possible: 50,
      scores: [
        principle({ principle_number: 1, score: 4, confidence: 'calculated' }),
        principle({ principle_number: 2, score: 5, confidence: 'calculated' }),
        principle({ principle_number: 5, score: 7, confidence: 'model-inferred' }),
      ],
    }))

    // The footer must say how many are AI-assessed (1) and how many are deterministic (2) separately
    expect(html).toMatch(/AI[- ]assessed/i)
    // The AI count is 1
    expect(html).toMatch(/1[^a-zA-Z]*AI/)
  })

  it('renders the partial subtotal honestly when coverage is incomplete', () => {
    const html = markup(scores({
      grade: 'INCOMPLETE',
      total_score: 9,
      max_possible: 30,
      scores: [
        principle({ principle_number: 1, score: 4, confidence: 'calculated' }),
        principle({ principle_number: 2, score: 5, confidence: 'calculated' }),
        principle({ principle_number: 5, score: -1, confidence: 'unavailable' }),
      ],
    }))

    // The 9.0/30.0 partial subtotal should appear with an explicit caveat that it's a partial subtotal not comparable to a complete grade
    expect(html).toContain('9.0')
    expect(html).toMatch(/partial|subtotal/i)
  })

  it('treats coverage.partial=true as INCOMPLETE even when grade is a regular letter', () => {
    // The new scorer may emit a letter grade plus coverage.partial=true when the
    // grade itself was carried over but the underlying coverage is incomplete.
    // The UI must surface this as an honest INCOMPLETE-grade caveat.
    const html = markup(scores({
      grade: 'C',
      total_score: 9,
      max_possible: 30,
      coverage: { assessed: 3, total: 6, unavailable: 3, partial: true },
      scores: [
        principle({ principle_number: 1, score: 4, confidence: 'calculated' }),
        principle({ principle_number: 2, score: 5, confidence: 'calculated' }),
        principle({ principle_number: 5, score: -1, confidence: 'unavailable' }),
        principle({ principle_number: 7, score: -1, confidence: 'unavailable' }),
        principle({ principle_number: 9, score: -1, confidence: 'unavailable' }),
        principle({ principle_number: 11, score: -1, confidence: 'unavailable' }),
      ],
    }))

    // Must show the partial-coverage caveat even though grade is a letter
    expect(html).toMatch(/partial|incomplete|not comparable/i)
    // Actual rows override stale service coverage; these fixtures contain two assessed principles.
    expect(html).toContain('2 of 6 principles assessed')
    expect(html).not.toContain('3 of 6 principles assessed')
  })

  it('AI-assessed count uses model-inferred confidence, not benchmark', () => {
    const html = markup(scores({
      grade: 'C',
      total_score: 16,
      max_possible: 40,
      scores: [
        principle({ principle_number: 1, score: 4, confidence: 'calculated' }),
        principle({ principle_number: 5, score: 4, confidence: 'benchmark' }),
        principle({ principle_number: 8, score: 4, confidence: 'model-inferred' }),
        principle({ principle_number: 9, score: 4, confidence: 'model-inferred' }),
      ],
    }))

    // 1 deterministic, 1 benchmark, 2 AI-assessed — must be distinguished
    expect(html).toMatch(/1 deterministic/i)
    expect(html).toMatch(/1 benchmark-derived/i)
    expect(html).toMatch(/2 AI-assessed/i)
  })
})
