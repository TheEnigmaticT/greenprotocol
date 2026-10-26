import type { AnalysisResult } from '@/lib/types'

/**
 * Server receipt for an approve or reject made from chat. `alreadyDecided` means the
 * recommendation was already in the requested state when the request arrived.
 */
export interface RecommendationDecisionReceipt {
  recommendationId: string
  decision: 'approved' | 'rejected'
  label: string
  alreadyDecided: boolean
  actionId: string
  revisionNumber: number
}

export function parseRecommendationDecisionReceipt(value: unknown): RecommendationDecisionReceipt | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  const { recommendationId, decision, label, alreadyDecided, actionId, revisionNumber } = data
  if (
    typeof recommendationId !== 'string'
    || !recommendationId.trim()
    || (decision !== 'approved' && decision !== 'rejected')
    || typeof label !== 'string'
    || !label.trim()
    || typeof alreadyDecided !== 'boolean'
    || typeof actionId !== 'string'
    || !actionId.trim()
    || typeof revisionNumber !== 'number'
    || !Number.isSafeInteger(revisionNumber)
    || revisionNumber < 1
  ) return null

  return { recommendationId, decision, label, alreadyDecided, actionId, revisionNumber }
}

/**
 * Mirrors the server write on the page's copy of the analysis: the matching recommendation
 * becomes accepted (approve) or explicitly declined (reject). The caller owns revision syncing.
 */
export function applyRecommendationDecision(
  analysis: AnalysisResult,
  receipt: Pick<RecommendationDecisionReceipt, 'recommendationId' | 'decision'>,
): AnalysisResult {
  const isAccepted = receipt.decision === 'approved'
  return {
    ...analysis,
    recommendations: analysis.recommendations.map(recommendation => (
      recommendation.id === receipt.recommendationId ? { ...recommendation, isAccepted } : recommendation
    )),
  }
}
