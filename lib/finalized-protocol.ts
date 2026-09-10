import { AnalysisResult, Recommendation } from './types'
import { isEvidenceEligibleChemicalSwap } from './recommendation-kind'

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

function applyAcceptedChemicalSwaps(text: string, recs: Recommendation[]): string {
  return recs
    .filter(rec => rec.isAccepted === true && isEvidenceEligibleChemicalSwap(rec))
    .sort((a, b) => b.original.chemical.length - a.original.chemical.length)
    .reduce((current, rec) => applyRecommendation(current, rec), text)
}

function buildStepProcedure(analysis: AnalysisResult, acceptedSwaps: Recommendation[]): string {
  const lines = analysis.steps.map((step) => {
    const stepRecs = acceptedSwaps.filter(rec => rec.stepNumber === step.stepNumber)
    const description = applyAcceptedChemicalSwaps(step.description, stepRecs)
    return `Step ${step.stepNumber}. ${description}`
  })

  return lines.join('\n\n')
}

export function buildFinalizedProtocol(
  analysis: AnalysisResult,
  originalProtocol?: string | null
): string {
  const accepted = analysis.recommendations.filter(rec => rec.isAccepted === true)
  const acceptedSwaps = accepted.filter(isEvidenceEligibleChemicalSwap)

  // Reuse assembled text only when every accepted recommendation was eligible
  // for application. Older analyses may contain a draft that applied a retained
  // hypothesis, which must not bypass the evidence gate here.
  if (
    accepted.length === analysis.recommendations.length
    && accepted.length === acceptedSwaps.length
    && analysis.revisedProtocol.trim()
  ) {
    return analysis.revisedProtocol
  }

  if (acceptedSwaps.length === 0) {
    return originalProtocol?.trim() || buildStepProcedure(analysis, [])
  }

  if (analysis.steps.length > 0) {
    return buildStepProcedure(analysis, acceptedSwaps)
  }

  return applyAcceptedChemicalSwaps(originalProtocol || analysis.revisedProtocol, acceptedSwaps)
}

