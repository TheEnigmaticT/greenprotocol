/**
 * Build citation strings from analysis metadata.
 *
 * Source hierarchy for scoring:
 *   1. Structured hazard data (GHS/PubChem) — primary scoring source
 *   2. SDS — supporting evidence and workflow context only
 */

import type { AnalysisMetadata, Recommendation } from '@/lib/types'

/**
 * Build a short software citation string for display or export.
 *
 * Example output:
 *   "GreenChemistry.ai v0.6.0, analysis generated 2026-05-20T14:23:18Z."
 */
export function buildCitationString(metadata: AnalysisMetadata): string {
  const date = metadata.generatedAt
    ? new Date(metadata.generatedAt).toISOString()
    : 'unknown date'
  return `GreenChemistry.ai v${metadata.gcaiVersion}, analysis generated ${date}.`
}

/**
 * Build a BibTeX-style citation for academic use.
 */
export function buildBibtexCitation(metadata: AnalysisMetadata, analysisId?: string): string {
  const year = metadata.generatedAt
    ? new Date(metadata.generatedAt).getFullYear()
    : new Date().getFullYear()
  const key = analysisId ? `gcai-${analysisId.slice(0, 8)}` : `gcai-${year}`

  return `@software{${key},
  title = {GreenChemistry.ai Protocol Analysis},
  version = {${metadata.gcaiVersion}},
  year = {${year}},
  url = {https://greenchemistry.ai}
}`
}

/**
 * Build a per-recommendation citation string for display or export.
 *
 * Example output:
 *   "GreenChemistry.ai v0.6.0. Recommendation: replace DMF with DMSO (Step 3). Generated 2026-05-21."
 */
export function buildRecommendationCitationString(
  rec: Recommendation,
  analysisId?: string
): string {
  const version = rec.citationMetadata?.gcaiVersion ?? 'unknown'
  const date = rec.citationMetadata?.generatedAt
    ? new Date(rec.citationMetadata.generatedAt).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0]
  const id = analysisId ?? rec.citationMetadata?.analysisId
  const idPart = id ? ` Analysis ID: ${id}.` : ''
  return `GreenChemistry.ai v${version}. Recommendation: replace ${rec.original.chemical} with ${rec.alternative.chemical} (Step ${rec.stepNumber}).${idPart} Generated ${date}.`
}
