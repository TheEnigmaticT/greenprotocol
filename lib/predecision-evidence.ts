import type { AnalysisStep, LiteratureEvidenceMatch } from '@/lib/types'

export interface PredecisionEvidenceInput {
  reactionSmiles?: string | null
  reactionSmilesMetadata?: Record<string, unknown>
  steps: AnalysisStep[]
  matches: LiteratureEvidenceMatch[]
  retrievalStatus?: 'completed' | 'unavailable'
}

function bounded(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

function reactionMaterials(steps: AnalysisStep[]) {
  return steps.flatMap(step => step.chemicals).filter(chemical =>
    ['reactant', 'reagent', 'product'].includes(chemical.role)
    && !['unknown', 'product', 'reactant', 'reagent'].includes(chemical.name.trim().toLowerCase()),
  )
}

export function buildPredecisionQuery(title: string, steps: AnalysisStep[]): string {
  const materials = [...new Set(reactionMaterials(steps).map(chemical => `${chemical.role}: ${chemical.name}`))]
  // The existing embedding model searches prose, not chemical structures.
  // Keep SMILES in the decision context, not as the dominant search text.
  return bounded(`Transformation: ${bounded(title, 120)}. ${materials.join('; ')}. Reaction conditions and reported product yield.`, 500)
}

function mentionsReactionMaterial(match: LiteratureEvidenceMatch, steps: AnalysisStep[]): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const text = ` ${normalize([match.title, match.quote, match.applicability, match.limitations].filter(Boolean).join(' '))} `
  return reactionMaterials(steps).some(chemical => {
    const name = normalize(chemical.name)
    return name.length > 0 && text.includes(` ${name} `)
  })
}

function materialAndConditionContext(steps: AnalysisStep[]): string {
  const materials = steps.flatMap(step => step.chemicals.map(chemical =>
    `${chemical.name} (${chemical.role}; declared quantity ${chemical.quantity || 'not declared'})`,
  ))
  const conditions = steps.map(step =>
    `step ${step.stepNumber}: temperature ${step.conditions.temperature ?? 'not declared'}; duration ${step.conditions.duration ?? 'not declared'}; atmosphere ${step.conditions.atmosphere ?? 'not declared'}`,
  )
  return [
    `Protocol materials: ${materials.length ? materials.join('; ') : 'none parsed'}.`,
    `Protocol conditions: ${conditions.length ? conditions.join('; ') : 'none parsed'}.`,
  ].join('\n')
}

/**
 * Bounded context supplied before principle generation. Retrieved dense-index
 * matches remain candidates: neither a similarity score nor a generic quote is
 * presented as a reaction precedent without a separate applicability review.
 */
export function buildPredecisionEvidenceContext(input: PredecisionEvidenceInput): string {
  const metadata = input.reactionSmilesMetadata ?? {}
  const reaction = metadata.validated === true ? input.reactionSmiles?.trim() : undefined
  const metadataSummary = Object.entries(metadata)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 8)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ') || 'none returned'

  const matches = input.matches.filter(match => mentionsReactionMaterial(match, input.steps)).slice(0, 3)
  const evidenceLines = input.retrievalStatus === 'unavailable'
    ? 'Literature retrieval unavailable; no conclusion about the absence of applicable literature can be drawn.'
    : matches.length
    ? matches.map((match, index) => [
      `Candidate evidence ${index + 1}: source_id=${match.id}; source_document_id=${match.sourceDocumentId}; source_type=literature_evidence_unit; title=${bounded(match.title, 180)}; pages=${match.pageStart}-${match.pageEnd}; doi=${match.doi ?? 'not returned'}; candidate_status=${match.candidateStatus}; similarity=${match.similarity.toFixed(3)}.`,
      `  Quote: ${bounded(match.quote, 700)}`,
      `  Reported applicability: ${bounded(match.applicability ?? 'not returned', 260)}. Limitations: ${bounded(match.limitations ?? 'not returned', 260)}.`,
    ].join('\n')).join('\n')
    : input.matches.length
      ? 'No retrieved candidates mention the declared reaction materials; unrelated semantic matches were excluded. This conservative name screen may miss synonyms and is not an exhaustive literature search.'
      : 'No literature evidence units were retrieved from the bounded index.'

  return [
    'PREDECISION REACTION EVIDENCE — inspect before proposing any chemical substitution.',
    reaction
      ? `Validated reaction representation: ${reaction}`
      : 'Validated reaction representation: unavailable.',
    `Reaction representation metadata: ${metadataSummary}.`,
    materialAndConditionContext(input.steps),
    evidenceLines,
    'Material-name overlap is a relevance screen only, not proof of the same transformation, product, conditions, or successful substitution.',
    'Applicability boundary: Semantic similarity alone is not an applicable reaction precedent. The retrieved units above are candidate context only; preserve their source IDs, quotes, conditions, and limitations. Do not describe model memory, generic solvent guidance, or a candidate match as sourced reaction support.',
    'Decision: No applicable reaction precedent is established by this bounded retrieval. A chemical substitution requires independent chemistry review and the later evidence/application gate; otherwise return no chemical_swap or a clearly non-substitution recommendation.',
  ].join('\n\n')
}
