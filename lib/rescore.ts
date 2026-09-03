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
  const status = analysis.chemistryDataStatus
  const unresolvedChemicals = status?.unresolvedChemicals ?? []
  const indefiniteChemicals = status?.indefiniteChemicals ?? []

  return {
    ...analysis,
    deterministicScores,
    chemistryDataStatus: status
      ? {
          ...status,
          pending: unresolvedChemicals.length > 0,
          deterministicScoringAvailable: true,
          message: unresolvedChemicals.length > 0
            ? 'We could not retrieve every chemical reference record live. This analysis used the best data available, and queued the missing items so the analysis can be re-run when updated reference data is available.'
            : indefiniteChemicals.length > 0
              ? 'Some protocol materials have indefinite composition and cannot be analyzed as single chemicals. They are excluded from PubChem recovery and chemistry scoring.'
              : 'All requested chemical reference data was available from cache or bundled sources.',
        }
      : undefined,
  }
}
