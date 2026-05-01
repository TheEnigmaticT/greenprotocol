import { AnalysisResult, Recommendation } from './types'

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

function applyAcceptedRecommendations(text: string, recs: Recommendation[]): string {
  return recs
    .filter(rec => rec.isAccepted === true)
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
  const accepted = analysis.recommendations.filter(rec => rec.isAccepted === true)

  if (accepted.length === analysis.recommendations.length && analysis.revisedProtocol.trim()) {
    return analysis.revisedProtocol
  }

  if (accepted.length === 0) {
    return originalProtocol?.trim() || buildStepProcedure(analysis, [])
  }

  if (analysis.steps.length > 0) {
    return buildStepProcedure(analysis, accepted)
  }

  return applyAcceptedRecommendations(originalProtocol || analysis.revisedProtocol, accepted)
}
