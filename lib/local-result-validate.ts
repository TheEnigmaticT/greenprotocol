/**
 * Runtime schema checks + one repair retry for Path B local scoring stages.
 * Fail closed: malformed principle / assemble / reevaluate JSON must not
 * become empty success (mirrors local-parse validate-and-repair).
 */
import {
  completeLocalJsonResult,
  type LocalJsonCompletionOptions,
  type LocalJsonCompletionResult,
} from '@/lib/local-llm'
import {
  baseChemicalName,
  classifyRecommendationKind,
  isSameChemicalTip,
} from '@/lib/recommendation-kind'
import type { Recommendation } from '@/lib/types'

export type LocalValidation<T> =
  | { ok: true; result: T }
  | { ok: false; reason: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSeverity(value: unknown): value is 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' || value === 'low'
}

function isConfidence(value: unknown): value is 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' || value === 'low'
}

function isKind(value: unknown): value is 'chemical_swap' | 'process_change' | 'analytical' {
  return value === 'chemical_swap' || value === 'process_change' || value === 'analytical'
}

function isHollowAlternativeChemical(value: string): boolean {
  return /^(?:none|n\/?a|na|null|undefined|no\s+(?:alternative|replacement)|not\s+applicable|-)$/i
    .test(value.trim())
}

/** Shape used downstream after principle scoring (dedup, lit query, ranking). */
export interface ValidatedPrincipleRecommendation {
  stepNumber: number
  principleNumbers?: number[]
  principleNames?: string[]
  severity: 'high' | 'medium' | 'low'
  kind?: 'chemical_swap' | 'process_change' | 'analytical'
  original: { chemical: string; issue: string }
  alternative: {
    chemical: string
    rationale: string
    yieldImpact?: string
    caveats?: string
    evidenceBasis?: string
  }
  confidenceLevel: 'high' | 'medium' | 'low'
  primaryBenefit?: string
}

export interface ValidatedPrincipleResult {
  principleNumber: number
  recommendations: ValidatedPrincipleRecommendation[]
}

export interface ValidatedAssembleResult {
  revisedProtocol: string
  overallAssessment: {
    greenPrinciplesViolated: number[]
    mostImpactfulChange: string
    experimentalValidationNeeded: boolean
    disclaimer: string
    processComplexity?: unknown
  }
}

export interface ValidatedReevaluationResult {
  action: 'confirm' | 'downgrade' | 'suppress'
  revisedConfidence: 'high' | 'medium' | 'low'
  revisedSeverity?: 'high' | 'medium' | 'low'
  revisedRationale: string
  evidenceAssessment: {
    supportsOriginalIssue: boolean
    supportsAlternative: boolean
    contextMatch: 'strong' | 'partial' | 'weak' | 'none'
    quantitativeData: boolean
  }
  concerns: string[]
  suppressionReason?: string
}

function validateRecommendation(
  raw: unknown,
  index: number,
): LocalValidation<ValidatedPrincipleRecommendation> {
  if (!isPlainObject(raw)) return { ok: false, reason: `rec_${index}_type` }
  if (typeof raw.stepNumber !== 'number' || !Number.isFinite(raw.stepNumber)) {
    return { ok: false, reason: `rec_${index}_stepNumber` }
  }
  if (!isPlainObject(raw.original)) return { ok: false, reason: `rec_${index}_original` }
  if (!isNonEmptyString(raw.original.chemical)) {
    return { ok: false, reason: `rec_${index}_original_chemical` }
  }
  if (!isNonEmptyString(raw.original.issue)) {
    return { ok: false, reason: `rec_${index}_original_issue` }
  }
  if (!isPlainObject(raw.alternative)) return { ok: false, reason: `rec_${index}_alternative` }
  if (!isNonEmptyString(raw.alternative.chemical)) {
    return { ok: false, reason: `rec_${index}_alternative_chemical` }
  }
  if (isHollowAlternativeChemical(raw.alternative.chemical) || !baseChemicalName(raw.alternative.chemical)) {
    return { ok: false, reason: `rec_${index}_alternative_chemical_hollow` }
  }
  if (!isNonEmptyString(raw.alternative.rationale)) {
    return { ok: false, reason: `rec_${index}_alternative_rationale` }
  }
  if (!isSeverity(raw.severity)) return { ok: false, reason: `rec_${index}_severity` }
  if (!isConfidence(raw.confidenceLevel)) {
    return { ok: false, reason: `rec_${index}_confidenceLevel` }
  }
  if (raw.kind !== undefined && raw.kind !== null && !isKind(raw.kind)) {
    return { ok: false, reason: `rec_${index}_kind` }
  }
  if (raw.kind === 'chemical_swap') {
    const rec = raw as unknown as Recommendation
    if (isSameChemicalTip(rec) || classifyRecommendationKind(rec) !== 'chemical_swap') {
      return { ok: false, reason: `rec_${index}_chemical_swap_not_substitution` }
    }
  }
  if (
    raw.principleNumbers !== undefined
    && raw.principleNumbers !== null
    && (!Array.isArray(raw.principleNumbers)
      || raw.principleNumbers.some((n) => typeof n !== 'number' || !Number.isFinite(n)))
  ) {
    return { ok: false, reason: `rec_${index}_principleNumbers` }
  }
  if (
    raw.principleNames !== undefined
    && raw.principleNames !== null
    && (!Array.isArray(raw.principleNames)
      || raw.principleNames.some((n) => typeof n !== 'string'))
  ) {
    return { ok: false, reason: `rec_${index}_principleNames` }
  }

  return {
    ok: true,
    result: raw as unknown as ValidatedPrincipleRecommendation,
  }
}

/**
 * Invalid when: not an object; principleNumber missing/non-finite;
 * recommendations not an array; any rec missing fields used downstream
 * (stepNumber, original.chemical/issue, alternative.chemical/rationale,
 * severity, confidenceLevel) or holding wrong types.
 * Empty recommendations[] is valid (principle found no issues).
 */
export function validatePrincipleResult(
  value: unknown,
): LocalValidation<ValidatedPrincipleResult> {
  if (!isPlainObject(value)) return { ok: false, reason: 'not_object' }
  if (typeof value.principleNumber !== 'number' || !Number.isFinite(value.principleNumber)) {
    return { ok: false, reason: 'principleNumber' }
  }
  if (!Array.isArray(value.recommendations)) {
    return { ok: false, reason: 'recommendations_not_array' }
  }
  const recommendations: ValidatedPrincipleRecommendation[] = []
  for (let i = 0; i < value.recommendations.length; i++) {
    const checked = validateRecommendation(value.recommendations[i], i)
    if (!checked.ok) return checked
    recommendations.push(checked.result)
  }
  return {
    ok: true,
    result: {
      principleNumber: value.principleNumber,
      recommendations,
    },
  }
}

export function validateAssembleResult(
  value: unknown,
): LocalValidation<ValidatedAssembleResult> {
  if (!isPlainObject(value)) return { ok: false, reason: 'not_object' }
  if (typeof value.revisedProtocol !== 'string') {
    return { ok: false, reason: 'revisedProtocol' }
  }
  if (!isPlainObject(value.overallAssessment)) {
    return { ok: false, reason: 'overallAssessment' }
  }
  const oa = value.overallAssessment
  if (!Array.isArray(oa.greenPrinciplesViolated)
    || oa.greenPrinciplesViolated.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return { ok: false, reason: 'greenPrinciplesViolated' }
  }
  if (!isNonEmptyString(oa.mostImpactfulChange)) {
    return { ok: false, reason: 'mostImpactfulChange' }
  }
  if (typeof oa.experimentalValidationNeeded !== 'boolean') {
    return { ok: false, reason: 'experimentalValidationNeeded' }
  }
  if (!isNonEmptyString(oa.disclaimer)) {
    return { ok: false, reason: 'disclaimer' }
  }
  return {
    ok: true,
    result: value as unknown as ValidatedAssembleResult,
  }
}

export function validateReevaluationResult(
  value: unknown,
): LocalValidation<ValidatedReevaluationResult> {
  if (!isPlainObject(value)) return { ok: false, reason: 'not_object' }
  if (value.action !== 'confirm' && value.action !== 'downgrade' && value.action !== 'suppress') {
    return { ok: false, reason: 'action' }
  }
  if (!isConfidence(value.revisedConfidence)) {
    return { ok: false, reason: 'revisedConfidence' }
  }
  if (value.revisedSeverity !== undefined && value.revisedSeverity !== null
    && !isSeverity(value.revisedSeverity)) {
    return { ok: false, reason: 'revisedSeverity' }
  }
  if (!isNonEmptyString(value.revisedRationale)) {
    return { ok: false, reason: 'revisedRationale' }
  }
  if (!isPlainObject(value.evidenceAssessment)) {
    return { ok: false, reason: 'evidenceAssessment' }
  }
  const ea = value.evidenceAssessment
  if (typeof ea.supportsOriginalIssue !== 'boolean') {
    return { ok: false, reason: 'supportsOriginalIssue' }
  }
  if (typeof ea.supportsAlternative !== 'boolean') {
    return { ok: false, reason: 'supportsAlternative' }
  }
  if (
    ea.contextMatch !== 'strong'
    && ea.contextMatch !== 'partial'
    && ea.contextMatch !== 'weak'
    && ea.contextMatch !== 'none'
  ) {
    return { ok: false, reason: 'contextMatch' }
  }
  if (typeof ea.quantitativeData !== 'boolean') {
    return { ok: false, reason: 'quantitativeData' }
  }
  if (!Array.isArray(value.concerns) || value.concerns.some((c) => typeof c !== 'string')) {
    return { ok: false, reason: 'concerns' }
  }
  if (value.action === 'suppress' && !isNonEmptyString(value.suppressionReason)) {
    return { ok: false, reason: 'suppressionReason' }
  }
  return {
    ok: true,
    result: value as unknown as ValidatedReevaluationResult,
  }
}

export type LocalResultValidator = (value: unknown) => LocalValidation<unknown>

/** Pick validator for Path B labels; null = no runtime schema (leave as JSON.parse cast). */
export function selectLocalResultValidator(label: string): LocalResultValidator | null {
  if (label.startsWith('principle-')) return validatePrincipleResult
  if (label === 'assemble') return validateAssembleResult
  if (label.startsWith('reevaluate')) return validateReevaluationResult
  return null
}

export function buildLocalRepairAddendum(reason: string, label: string): string {
  if (label.startsWith('principle-')) {
    return (
      `Previous JSON failed validation (${reason}). `
      + 'Return an object with numeric principleNumber and recommendations as an array. '
      + 'Each recommendation MUST include stepNumber, severity (high|medium|low), '
      + 'confidenceLevel (high|medium|low), original.{chemical,issue}, '
      + 'and alternative.{chemical,rationale} as non-empty strings. '
      + 'For chemical_swap, alternative.chemical MUST be a concrete, different chemical, not none, a dose tip, or an analytical method. '
      + 'Use [] when there are no recommendations. Return ONLY JSON.'
    )
  }
  if (label === 'assemble') {
    return (
      `Previous JSON failed validation (${reason}). `
      + 'Return revisedProtocol (string) and overallAssessment with '
      + 'greenPrinciplesViolated (number[]), mostImpactfulChange (string), '
      + 'experimentalValidationNeeded (boolean), disclaimer (string). Return ONLY JSON.'
    )
  }
  if (label.startsWith('reevaluate')) {
    return (
      `Previous JSON failed validation (${reason}). `
      + 'Return action (confirm|downgrade|suppress), revisedConfidence (high|medium|low), '
      + 'revisedRationale (string), evidenceAssessment '
      + '{supportsOriginalIssue,supportsAlternative,contextMatch,quantitativeData}, '
      + 'and concerns (string[]). If action=suppress include suppressionReason. Return ONLY JSON.'
    )
  }
  return `Previous JSON failed validation (${reason}). Return ONLY valid JSON matching the schema.`
}

/**
 * completeLocalJsonResult + runtime validate; on failure, one repair retry with
 * a short system addendum. Still invalid → throw (fail closed).
 */
export async function completeLocalJsonValidated<T = unknown>(
  options: LocalJsonCompletionOptions,
): Promise<LocalJsonCompletionResult<T>> {
  const label = options.label ?? 'local-json'
  const validator = selectLocalResultValidator(label)
  const first = await completeLocalJsonResult<T>(options)
  if (!validator) return first

  let checked = validator(first.data)
  if (checked.ok) {
    return { ...first, data: checked.result as T }
  }

  console.warn(
    `[local-llm] ${label}: validation failed (${checked.reason}); repairing once`,
  )
  const repairSystem = `${options.system}\n\n${buildLocalRepairAddendum(checked.reason, label)}`
  const second = await completeLocalJsonResult<T>({
    ...options,
    system: repairSystem,
  })
  checked = validator(second.data)
  if (!checked.ok) {
    throw new Error(`local_pipeline_invalid:${label}:${checked.reason}`)
  }
  return { ...second, data: checked.result as T }
}
