import type { AnalysisResult, DeterministicScores } from '@/lib/types'

export async function rescoreAnalysis(analysis: AnalysisResult): Promise<DeterministicScores> {
  const res = await fetch('/api/rescore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis }),
  })
  if (!res.ok) {
    throw new Error('Unable to re-score this analysis')
  }
  return await res.json() as DeterministicScores
}

export function applyDeterministicScores(
  analysis: AnalysisResult,
  deterministicScores: DeterministicScores,
): AnalysisResult {
  return { ...analysis, deterministicScores }
}
