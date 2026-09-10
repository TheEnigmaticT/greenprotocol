import type { Recommendation } from '@/lib/types'
import { isEvidenceEligibleChemicalSwap, isChemicalSwapRecommendation } from '@/lib/recommendation-kind'

export interface RecommendationApplicationStatus {
  isChemicalSwap: boolean
  isEligible: boolean
  isWithheld: boolean
  reason?: string
  label?: string
}

/**
 * UI-facing interpretation of the central evidence-eligibility gate.
 * Non-swap recommendations remain reviewable; only unsupported substitutions
 * are withheld from protocol application.
 */
export function recommendationApplicationStatus(rec: Recommendation): RecommendationApplicationStatus {
  const isChemicalSwap = isChemicalSwapRecommendation(rec)
  const isEligible = isEvidenceEligibleChemicalSwap(rec)

  if (!isChemicalSwap || isEligible) {
    return { isChemicalSwap, isEligible, isWithheld: false }
  }

  const eligibility = rec.applicationEligibility
  const missingGateReason = 'Reaction-applicable evidence has not been recorded, so this substitution cannot be applied.'
  const reason = eligibility?.reason?.trim() || missingGateReason
  const label = eligibility?.status === 'unavailable'
    ? 'Evidence unavailable'
    : eligibility?.status === 'hypothesis_only'
      ? 'Hypothesis only'
      : 'Evidence gate incomplete'

  return { isChemicalSwap, isEligible: false, isWithheld: true, reason, label }
}

export function RecommendationApplicationNotice({ rec }: { rec: Recommendation }) {
  const status = recommendationApplicationStatus(rec)
  if (!status.isWithheld) return null

  return (
    <div
      className="mt-2 p-2 rounded text-xs"
      style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E' }}
      role="note"
    >
      <strong>Not eligible for protocol application — {status.label}.</strong> {status.reason}
    </div>
  )
}
