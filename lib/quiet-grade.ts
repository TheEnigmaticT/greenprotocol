import type { AnalysisResult, DeterministicScores } from '@/lib/types'
import { getScoreCoverage } from '@/lib/score-coverage'

/** Compact status line: `C · 56.1/120 · 3 pending · 1 accepted · lower = greener` */
export function buildQuietGradeLine(
  analysis: AnalysisResult,
  scores?: DeterministicScores | null,
): string {
  const parts: string[] = []
  const ds = scores ?? analysis.deterministicScores
  if (ds) {
    const coverage = getScoreCoverage(ds)
    if (coverage.hasGrade) {
      parts.push(ds.grade)
      parts.push(`${ds.total_score.toFixed(1)}/${ds.max_possible.toFixed(0)}`)
      parts.push(`${coverage.available.length} available`)
    } else {
      parts.push('Grade unavailable')
    }
  }
  const pending = analysis.recommendations.filter(r => r.isAccepted === undefined || r.isAccepted === null).length
  const accepted = analysis.recommendations.filter(r => r.isAccepted === true).length
  if (analysis.recommendations.length > 0) {
    parts.push(`${pending} pending`)
    parts.push(`${accepted} accepted`)
  }
  parts.push('lower = greener')
  return parts.join(' · ')
}
