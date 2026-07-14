/**
 * Build citation strings from analysis metadata.
 *
 * Source hierarchy for scoring:
 *   1. Structured hazard data (GHS/PubChem) — primary scoring source
 *   2. SDS — supporting evidence and workflow context only
 */

import type { AnalysisMetadata, Recommendation, Citation } from '@/lib/types'

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

/**
 * Format a literature citation in ACS (American Chemical Society) style.
 * 
 * ACS format:
 * Author1, A.; Author2, B.; Author3, C. Title. Journal Year, Volume, Pages. DOI: 10.xxxx/xxxxx
 * 
 * Example:
 * Prat, D.; Wells, A.; Hayler, J. CHEM21 Selection Guide of Classical-Solvents. Green Chem. 2016, 18, 288-296. DOI: 10.1039/c5gc01008j
 */
export function formatCitationACS(citation: Citation): string {
  const parts: string[] = []
  
  // Authors (already formatted as "Last, F.; Last2, F2;")
  if (citation.citation) {
    // Extract authors from the existing citation string (format: "Authors (Year). Title.")
    const match = citation.citation.match(/^(.+?)\s*\((\d{4}|n\.d\.)\)\.\s*(.+)\./)
    if (match) {
      const [, authors, year, title] = match
      parts.push(authors)
      
      // Title
      if (title) {
        parts.push(title)
      }
      
      // Journal and year
      if (citation.source_name && year !== 'n.d.') {
        // Abbreviate common journals for ACS style
        const journalAbbr = citation.source_name
          .replace('Green Chemistry', 'Green Chem.')
          .replace('ACS Sustainable Chemistry & Engineering', 'ACS Sustain. Chem. Eng.')
          .replace('Chemical Reviews', 'Chem. Rev.')
          .replace('Journal of the American Chemical Society', 'J. Am. Chem. Soc.')
        
        parts.push(`${journalAbbr} ${year}`)
      }
      
      // DOI
      if (citation.doi) {
        return `${parts.join('. ')}. DOI: ${citation.doi}`
      }
      
      return parts.join('. ') + '.'
    }
  }
  
  // Fallback: use the original citation string with DOI appended
  if (citation.doi) {
    return `${citation.citation} DOI: ${citation.doi}`
  }
  
  return citation.citation || citation.source_name || 'Unknown source'
}
