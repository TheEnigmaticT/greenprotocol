import type { AnalysisResult, DeterministicScores } from '@/lib/types'
import { buildChemistryStatusMessage } from '@/lib/chemistry-status-message'
import { HumanErrorException, humanizeError, parseErrorBody, type ErrorCode } from '@/lib/errors/humanize'

/** Used only when the response carries no usable code (for example a gateway page). */
const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'invalid_analysis',
  401: 'unauthorized',
  503: 'chemistry_service_unavailable',
}

/**
 * Re-scores an analysis. On failure it throws a HumanErrorException whose
 * wording depends on why scoring failed: reference service down, saved analysis
 * unusable, or scoring itself failing. A dropped connection reads as the service being unreachable.
 */
export async function rescoreAnalysis(analysis: AnalysisResult): Promise<DeterministicScores> {
  let res: Response
  try {
    res = await fetch('/api/rescore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis }),
    })
  } catch {
    throw new HumanErrorException(humanizeError({ code: 'chemistry_service_unavailable' }))
  }
  if (!res.ok) {
    const { code } = parseErrorBody(await res.json().catch(() => null))
    throw new HumanErrorException(humanizeError({ code: code ?? CODE_BY_STATUS[res.status] ?? 'scoring_failed' }))
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
          message: buildChemistryStatusMessage({
            scoringAvailable: true,
            unresolvedCount: unresolvedChemicals.length,
            indefiniteCount: indefiniteChemicals.length,
          }),
        }
      : undefined,
  }
}
