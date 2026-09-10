import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ScoreCard from '@/components/ScoreCard'
import { buildQuietGradeLine } from '@/lib/quiet-grade'
import { compareScoreCoverage, getScoreCoverage } from '@/lib/score-coverage'
import type { DeterministicScores, PrincipleScore } from '@/lib/types'

function principle(
  principle_number: number,
  score: number,
  confidence: PrincipleScore['confidence'] = 'calculated',
): PrincipleScore {
  return {
    principle_number,
    principle_name: `Principle ${principle_number}`,
    score,
    max_score: 10,
    normalized: score < 0 ? -1 : score / 10,
    details: {},
    chemicals_flagged: [],
    data_sources: [],
    confidence,
  }
}

function scoreSet(entries: PrincipleScore[], grade = 'B'): DeterministicScores {
  return {
    scores: entries,
    total_score: entries.filter(entry => entry.score >= 0).reduce((total, entry) => total + entry.score, 0),
    max_possible: entries.filter(entry => entry.score >= 0).length * 10,
    grade,
    smiles_extraction: {},
    yield_extraction: {},
  }
}

describe('score coverage', () => {
  it('counts only valid available principle scores and exposes provenance', () => {
    const coverage = getScoreCoverage(scoreSet([
      principle(1, 2, 'calculated'),
      principle(2, 4, 'declared'),
      principle(3, 5, 'benchmark'),
      principle(4, 6, 'model-inferred'),
      principle(5, -1, 'unavailable'),
      principle(2, 1, 'calculated'),
      principle(13, 3, 'calculated'),
    ]))

    expect(coverage.available).toHaveLength(4)
    expect(coverage.availablePrincipleNumbers).toEqual([1, 2, 3, 4])
    expect(coverage.calculatedOrDeclared).toBe(2)
    expect(coverage.benchmarkOrModel).toBe(2)
    expect(coverage.unavailable).toBe(8)
  })

  it('does not treat out-of-range values as available coverage', () => {
    const invalid = principle(1, 11, 'calculated')
    const coverage = getScoreCoverage(scoreSet([invalid]))

    expect(coverage.hasGrade).toBe(false)
    expect(coverage.unavailable).toBe(12)
  })

  it('does not support a grade when no valid principle score is available', () => {
    const scores = scoreSet([principle(1, -1, 'unavailable')], 'C')
    const coverage = getScoreCoverage(scores)

    expect(coverage.hasGrade).toBe(false)
    expect(renderToStaticMarkup(createElement(ScoreCard, { scores }))).toContain('Grade unavailable')
    expect(renderToStaticMarkup(createElement(ScoreCard, { scores }))).not.toContain('>C<')
    expect(renderToStaticMarkup(createElement(ScoreCard, { scores }))).not.toContain('0.0/0')
    expect(buildQuietGradeLine({ recommendations: [], deterministicScores: scores } as never)).toBe('Grade unavailable · lower = greener')
  })

  it('does not compare projected grades across changed score coverage or provenance', () => {
    const original = scoreSet([principle(1, 4, 'calculated'), principle(2, 5, 'benchmark')], 'B')
    const missingProjected = scoreSet([principle(1, 2, 'calculated')], 'A')
    const changedProvenance = scoreSet([principle(1, 2, 'calculated'), principle(2, 1, 'calculated')], 'A')

    expect(compareScoreCoverage(original, missingProjected).comparable).toBe(false)
    expect(compareScoreCoverage(original, changedProvenance).comparable).toBe(false)
    expect(renderToStaticMarkup(createElement(ScoreCard, { scores: original, projectedScores: missingProjected })))
      .toContain('Projected score is not comparable')
  })

  it('does not mutate the caller score order while rendering', () => {
    const scores = scoreSet([principle(12, 3), principle(1, 2)])

    renderToStaticMarkup(createElement(ScoreCard, { scores }))

    expect(scores.scores.map(entry => entry.principle_number)).toEqual([12, 1])
  })
})
