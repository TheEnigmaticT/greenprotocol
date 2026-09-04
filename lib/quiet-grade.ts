import type { AnalysisResult, DeterministicScores } from '@/lib/types'

/** Compact status line: `C · 56.1/120 · 3 pending · 1 accepted · lower = greener` */
export function buildQuietGradeLine(
  analysis: AnalysisResult,
  scores?: DeterministicScores | null,
): string {
  const parts: string[] = []
  const ds = scores ?? analysis.deterministicScores
  if (ds) {
    parts.push(ds.grade)
    parts.push(`${ds.total_score.toFixed(1)}/${ds.max_possible.toFixed(0)}`)
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
