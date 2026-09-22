import type {
  RecommendationDisposition,
  RecommendationEvidenceAssessment,
} from '@/lib/types'

/** Pure disposition helpers — no Node builtins / no ACS GCIPR fs lookups. */

export function isVisibleDisposition(disposition: RecommendationDisposition): boolean {
  return disposition !== 'contradicted_or_inapplicable'
}

export function isPhraseableDisposition(disposition: RecommendationDisposition): boolean {
  return disposition === 'supported_applicable' || disposition === 'supported_with_constraints'
}

/** Recommendations that may revise the assembled/finalized procedure. */
export function isEligibleToReviseProcedure(assessment: RecommendationEvidenceAssessment | undefined): boolean {
  if (!assessment) return false
  return assessment.eligibleForApplication && assessment.disposition === 'supported_applicable'
}
