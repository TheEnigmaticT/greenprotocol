import type { Recommendation } from '@/lib/types'

export type RecommendationKind = 'chemical_swap' | 'process_change' | 'analytical'

export const RECOMMENDATION_KINDS: readonly RecommendationKind[] = [
  'chemical_swap',
  'process_change',
  'analytical',
] as const

const ANALYTICAL_RE =
  /\b(tlc|hplc|uhplc|gc[- ]?ms|gc\b|nmr|ir\b|ft[- ]?ir|raman|uv[- ]?vis|monitoring|inline|in[- ]line|real[- ]?time|in[- ]process|spectrophotometr|assay|spectroscopy)\b/i

const PROCESS_RE =
  /\b(microwave|reflux(?:\s*time)?|temperature|ambient|heating|cooling|pressure|energy|flow\s*chemistry|reaction\s*time|shorter\s*reaction|lower\s*temp|dose|equivalents?|stoichiometr|catalyst\s*loading|room[- ]?temp(?:erature)?)\b/i

/** Strip parentheticals and trailing dose/process suffixes before comparing chemical names. */
export function baseChemicalName(raw: string | undefined | null): string {
  if (typeof raw !== 'string') return ''
  let s = raw.trim()
  if (!s) return ''
  // Drop separated prose qualifiers, never groups within a chemical formula:
  // Zn(OH)2 and Zn(OAc)2 must remain distinct identities.
  s = s.replace(/\s+\([^)]*\)/g, ' ')
  // Compare substance identity separately from an explicit numeric dose suffix.
  // This only makes an instruction a same-chemical tip if the original matches;
  // a different catalyst at a stated dose remains a distinct replacement.
  s = s.replace(
    /\s+at\s+[~≈<>≤≥]?\s*\d+(?:\.\d+)?(?:\s*[-–—]\s*\d+(?:\.\d+)?)?\s*(?:mol\s*%|wt\s*%|%|equiv(?:alents?)?|mmol|mol|mg|kg|g|mL|L)(?=\s|$|\().*$/i,
    '',
  )
  // Trailing reduced-quantity / addition-style suffixes without parentheses
  s = s.replace(
    /\s*[,:;–—-]?\s*(reduced\s+quantity.*|reduced\s+dose.*|added\s+slowly.*|with\s+stirring.*)$/i,
    ''
  )
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

function normalizeKind(value: unknown): RecommendationKind | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if ((RECOMMENDATION_KINDS as readonly string[]).includes(normalized)) {
    return normalized as RecommendationKind
  }
  return null
}

function tipCorpus(rec: Pick<Recommendation, 'original' | 'alternative' | 'primaryBenefit'>): string {
  return [
    rec.original?.chemical,
    rec.original?.issue,
    rec.alternative?.chemical,
    rec.alternative?.rationale,
    rec.alternative?.caveats,
    rec.alternative?.evidenceBasis,
    rec.primaryBenefit,
  ]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' \n ')
}

export function isSameChemicalTip(rec: Pick<Recommendation, 'original' | 'alternative'>): boolean {
  const original = baseChemicalName(rec.original?.chemical)
  const alternative = baseChemicalName(rec.alternative?.chemical)
  return original.length > 0 && alternative.length > 0 && original === alternative
}

function hasDistinctChemicals(rec: Pick<Recommendation, 'original' | 'alternative'>): boolean {
  const original = baseChemicalName(rec.original?.chemical)
  const alternative = baseChemicalName(rec.alternative?.chemical)
  return original.length > 0 && alternative.length > 0 && original !== alternative
}

function hasAnalyticalCues(
  rec: Pick<Recommendation, 'original' | 'alternative' | 'primaryBenefit'>
): boolean {
  const alt = rec.alternative?.chemical ?? ''
  const rationale = rec.alternative?.rationale ?? ''
  const caveats = rec.alternative?.caveats ?? ''
  return (
    ANALYTICAL_RE.test(alt) ||
    ANALYTICAL_RE.test(rationale) ||
    ANALYTICAL_RE.test(caveats)
  )
}

/** True when the alternative string itself reads as a process tip (microwave, ambient temp, …). */
function alternativeLooksLikeProcessTip(alt: string): boolean {
  // An imperative operation is not a concrete replacement substance. In
  // particular, do not turn correct model process labels into swaps merely
  // because the instruction differs textually from the original name.
  const operation = /^\s*(?:add(?:ition)?|reduc(?:e|ed|tion)|decreas(?:e|ed)|increas(?:e|ed)|adjust(?:ed|ment)?|limit|optimi[sz](?:e|ed|ation)|cool|pre[- ]?cool|heat|stir|(?:re)?crystalli[sz]ation|distillation|filtration)\b/i
  const operatingDetail = /\b(?:addition|portion[- ]wise|dropwise|stoichiometr(?:y|ic)|loading|recovery\s+from)\b/i
  return PROCESS_RE.test(alt) || operation.test(alt) || operatingDetail.test(alt)
}

/** Heuristic tip signal only — null means no tip override. */
export function heuristicTipKind(
  rec: Pick<Recommendation, 'original' | 'alternative' | 'primaryBenefit'>
): RecommendationKind | null {
  if (hasAnalyticalCues(rec)) {
    return 'analytical'
  }

  if (isSameChemicalTip(rec)) {
    return 'process_change'
  }

  const alt = rec.alternative?.chemical ?? ''
  if (alternativeLooksLikeProcessTip(alt)) {
    return 'process_change'
  }

  return null
}

/**
 * Resolve recommendation kind.
 * Override order:
 * 1. analytical — monitoring/analysis cues
 * 2. process_change — same base chemical after stripping parentheticals/suffixes
 * 3. chemical_swap — meaningfully different base chemical names (even if model said process)
 * 4. else trust model kind; else default chemical_swap
 */
export function classifyRecommendationKind(
  rec: Pick<Recommendation, 'kind' | 'original' | 'alternative' | 'primaryBenefit'>
): RecommendationKind {
  const modelKind = normalizeKind(rec.kind)
  const alt = rec.alternative?.chemical ?? ''

  // 1. An analytical method cannot be a replacement chemical.
  if (ANALYTICAL_RE.test(alt)) {
    return 'analytical'
  }

  // 1b. Model sometimes invents a different alt name while saying "same reagent" /
  //     modified addition — treat as process_change, not chemical_swap.
  const sameReagentCue = /\bsame\s+reagent\b|\bsame\s+chemical\b|\bmodified\s+addition\b|\baddition\s+rate\b/i
  if (sameReagentCue.test(tipCorpus(rec))) {
    return 'process_change'
  }

  // 2. Same base chemical (water→water (...), anhydride→anhydride (reduced...)) → process tip.
  if (isSameChemicalTip(rec)) {
    return 'process_change'
  }

  // 3. Different substance names → chemical_swap, even if model said process_change.
  //    Do not let corpus words like "energy" / "resin" / "catalyst" keep a false Process label.
  //    Exception: alternative itself is a process phrase (microwave heating, ambient temperature).
  if (alternativeLooksLikeProcessTip(alt)) return 'process_change'
  if (hasDistinctChemicals(rec)) {
    return 'chemical_swap'
  }

  // An otherwise non-substitution recommendation can still be analytical when
  // its rationale is about monitoring. Deliberately after real swaps: a valid
  // reagent/catalyst swap may include a monitoring caveat.
  if (hasAnalyticalCues(rec)) return 'analytical'

  // 4. Trust model kind when present; else process-tip heuristic; else chemical_swap.
  if (modelKind) return modelKind

  const tipKind = heuristicTipKind(rec)
  if (tipKind) return tipKind

  const corpus = tipCorpus(rec)
  if (PROCESS_RE.test(corpus) || PROCESS_RE.test(alt)) {
    return 'process_change'
  }

  return 'chemical_swap'
}

export function resolveRecommendationKind(rec: Recommendation): RecommendationKind {
  return classifyRecommendationKind(rec)
}

export function stampRecommendationKind<T extends Recommendation>(rec: T): T {
  return { ...rec, kind: classifyRecommendationKind(rec) }
}

export function stampRecommendationKinds(recs: Recommendation[]): Recommendation[] {
  return recs.map(stampRecommendationKind)
}

export function isChemicalSwapRecommendation(rec: Recommendation): boolean {
  return resolveRecommendationKind(rec) === 'chemical_swap'
}

/**
 * A retained substitution hypothesis is not an instruction to edit a
 * procedure. Only a chemical swap explicitly marked supported by the
 * re-evaluation evidence gate may reach assembly/finalization.
 */
export function isEvidenceEligibleChemicalSwap(rec: Recommendation): boolean {
  return isChemicalSwapRecommendation(rec) && rec.applicationEligibility?.status === 'supported'
}

/** Assemble / revised-protocol path: evidence-supported chemical substitutions only. */
export function recommendationsForAssemble(recs: Recommendation[]): Recommendation[] {
  return recs.filter(isEvidenceEligibleChemicalSwap)
}

/** Literature grounding + Phase 2.7 reevaluation: chemical_swap only. */
export function recommendationsForLiteratureReevaluation(recs: Recommendation[]): Recommendation[] {
  return recs.filter(isChemicalSwapRecommendation)
}

export function kindBadgeLabel(kind: RecommendationKind): string {
  switch (kind) {
    case 'process_change':
      return 'Process'
    case 'analytical':
      return 'Analytical'
    case 'chemical_swap':
    default:
      return 'Substitution'
  }
}
