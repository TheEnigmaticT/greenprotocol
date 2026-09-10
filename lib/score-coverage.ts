import type { DeterministicScores, PrincipleScore, ScoreProvenance } from './types'

const PRINCIPLE_COUNT = 12
const AVAILABLE_PROVENANCE = new Set<ScoreProvenance>([
  'declared',
  'calculated',
  'benchmark',
  'model-inferred',
])

export interface ScoreCoverage {
  /** One valid, available entry for each scored principle; duplicate entries are ignored. */
  available: PrincipleScore[]
  availablePrincipleNumbers: number[]
  calculatedOrDeclared: number
  benchmarkOrModel: number
  unavailable: number
  hasGrade: boolean
}

/**
 * Returns the displayable score coverage without trusting aggregate fields or
 * placeholder entries. A grade can only be shown when at least one principle
 * has a valid, available score with known provenance.
 */
export function getScoreCoverage(scores: DeterministicScores): ScoreCoverage {
  const byPrinciple = new Map<number, PrincipleScore>()

  for (const score of scores.scores) {
    if (
      !Number.isInteger(score.principle_number)
      || score.principle_number < 1
      || score.principle_number > PRINCIPLE_COUNT
      || byPrinciple.has(score.principle_number)
      || !Number.isFinite(score.score)
      || score.score < 0
      || !Number.isFinite(score.max_score)
      || score.max_score <= 0
      || score.score > score.max_score
      || !AVAILABLE_PROVENANCE.has(score.confidence)
    ) continue

    byPrinciple.set(score.principle_number, score)
  }

  const available = [...byPrinciple.values()].sort((a, b) => a.principle_number - b.principle_number)
  const calculatedOrDeclared = available.filter(score => score.confidence === 'calculated' || score.confidence === 'declared').length
  const benchmarkOrModel = available.length - calculatedOrDeclared

  return {
    available,
    availablePrincipleNumbers: available.map(score => score.principle_number),
    calculatedOrDeclared,
    benchmarkOrModel,
    unavailable: PRINCIPLE_COUNT - available.length,
    hasGrade: available.length > 0,
  }
}

export interface ScoreCoverageComparison {
  comparable: boolean
  reason?: 'different-principles' | 'different-provenance'
}

/**
 * A before/after grade is only comparable if it covers the same principles and
 * each corresponding value has the same provenance. This prevents a missing
 * result or an estimate from being presented as an improvement.
 */
export function compareScoreCoverage(
  original: DeterministicScores,
  projected: DeterministicScores,
): ScoreCoverageComparison {
  const before = getScoreCoverage(original)
  const after = getScoreCoverage(projected)

  if (!before.hasGrade || !after.hasGrade || before.availablePrincipleNumbers.join(',') !== after.availablePrincipleNumbers.join(',')) {
    return { comparable: false, reason: 'different-principles' }
  }

  const projectedByPrinciple = new Map(after.available.map(score => [score.principle_number, score]))
  for (const score of before.available) {
    if (projectedByPrinciple.get(score.principle_number)?.confidence !== score.confidence) {
      return { comparable: false, reason: 'different-provenance' }
    }
  }

  return { comparable: true }
}

export function scoreCoverageDescription(coverage: ScoreCoverage): string {
  const parts: string[] = []
  if (coverage.calculatedOrDeclared > 0) parts.push(`${coverage.calculatedOrDeclared} calculated or declared`)
  if (coverage.benchmarkOrModel > 0) parts.push(`${coverage.benchmarkOrModel} benchmark-derived or AI-estimated`)
  if (coverage.unavailable > 0) parts.push(`${coverage.unavailable} unavailable`)
  return parts.join(' · ')
}
