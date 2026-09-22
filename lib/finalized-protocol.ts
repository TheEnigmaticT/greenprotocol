import { AnalysisResult, Recommendation } from './types'
import { isEligibleToReviseProcedure } from './recommendation-candidates'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function applyRecommendation(text: string, rec: Recommendation): string {
  const original = rec.original.chemical.trim()
  const alternative = rec.alternative.chemical.trim()

  if (!original || !alternative) return text

  const pattern = new RegExp(escapeRegExp(original), 'gi')
  return text.replace(pattern, alternative)
}

/**
 * Fail-closed procedure revision gate.
 * - Legacy recommendations without evidenceAssessment remain applyable when accepted.
 * - supported_applicable is always applyable when accepted.
 * - supported_with_constraints may apply only after explicit user acceptance.
 * - analogous_only / insufficient_evidence / contradicted never revise the procedure.
 */
export function canApplyAcceptedRecommendation(rec: Recommendation): boolean {
  // A warning names no replacement. Accept is not a real action on it.
  if (rec.cardKind === 'warning') return false
  // ACS GCIPR solvent-catalog and reagent-guide cards never revise text,
  // including after a user accepts the card.
  if (rec.acsGcipr?.revisesProcedure === false) return false
  if (rec.isAccepted !== true) return false
  const assessment = rec.evidenceAssessment
  if (!assessment) return true
  if (isEligibleToReviseProcedure(assessment)) return true
  return assessment.disposition === 'supported_with_constraints'
}

function applyAcceptedRecommendations(text: string, recs: Recommendation[]): string {
  return recs
    .filter(canApplyAcceptedRecommendation)
    .sort((a, b) => b.original.chemical.length - a.original.chemical.length)
    .reduce((current, rec) => applyRecommendation(current, rec), text)
}

function buildStepProcedure(analysis: AnalysisResult, accepted: Recommendation[]): string {
  const lines = analysis.steps.map((step) => {
    const stepRecs = accepted.filter(rec => rec.stepNumber === step.stepNumber)
    const description = applyAcceptedRecommendations(step.description, stepRecs)
    return `Step ${step.stepNumber}. ${description}`
  })

  return lines.join('\n\n')
}

export function buildFinalizedProtocol(
  analysis: AnalysisResult,
  originalProtocol?: string | null
): string {
  const acceptedApplicable = analysis.recommendations.filter(canApplyAcceptedRecommendation)

  // Only reuse the assembled revision when every accepted-applicable change is represented
  // and the assembly itself was produced under the fail-closed gate.
  if (
    acceptedApplicable.length > 0
    && acceptedApplicable.length === analysis.recommendations.filter(rec => rec.isAccepted === true).length
    && analysis.revisedProtocol.trim()
  ) {
    return analysis.revisedProtocol
  }

  if (acceptedApplicable.length === 0) {
    return originalProtocol?.trim() || buildStepProcedure(analysis, [])
  }

  if (analysis.steps.length > 0) {
    return buildStepProcedure(analysis, acceptedApplicable)
  }

  return applyAcceptedRecommendations(originalProtocol || analysis.revisedProtocol, acceptedApplicable)
}
