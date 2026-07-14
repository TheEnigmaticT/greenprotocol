/**
 * Validation utilities for score provenance taxonomy.
 * 
 * See docs/SCORING_PROVENANCE_TAXONOMY.md for the canonical taxonomy.
 */

import type { PrincipleScore, ScoreProvenance } from './types'

const VALID_PROVENANCE_VALUES: ScoreProvenance[] = [
  'declared',
  'calculated',
  'benchmark',
  'model-inferred',
  'unavailable',
]

/**
 * Type guard to check if a string is a valid ScoreProvenance value.
 */
export function isValidProvenance(value: unknown): value is ScoreProvenance {
  return typeof value === 'string' && VALID_PROVENANCE_VALUES.includes(value as ScoreProvenance)
}

/**
 * Validation errors for a single PrincipleScore.
 */
export interface ProvenanceValidationError {
  field: string
  message: string
}

/**
 * Validate a single PrincipleScore against provenance taxonomy rules.
 * 
 * Rules:
 * 1. confidence must be a valid ScoreProvenance value
 * 2. unavailable must pair with score === -1 and normalized === -1
 * 3. model-inferred must include reasoning in details
 * 4. non-unavailable scores must have at least one data source
 * 5. data_sources must not contain internal pipeline values (cache, not_found, error, unknown, none)
 * 
 * @returns Array of validation errors (empty if valid)
 */
export function validateScore(score: PrincipleScore): ProvenanceValidationError[] {
  const errors: ProvenanceValidationError[] = []

  // Rule 1: Valid provenance value
  if (!isValidProvenance(score.confidence)) {
    errors.push({
      field: 'confidence',
      message: `Invalid confidence value: "${score.confidence}". Must be one of: ${VALID_PROVENANCE_VALUES.join(', ')}`,
    })
  }

  // Rule 2: Unavailable scores must have score === -1
  if (score.confidence === 'unavailable') {
    if (score.score !== -1) {
      errors.push({
        field: 'score',
        message: `Unavailable scores must have score === -1 (got ${score.score})`,
      })
    }
    if (score.normalized !== -1) {
      errors.push({
        field: 'normalized',
        message: `Unavailable scores must have normalized === -1 (got ${score.normalized})`,
      })
    }
  }

  // Rule 3: Model-inferred must include reasoning
  if (score.confidence === 'model-inferred') {
    if (!score.details.reasoning || typeof score.details.reasoning !== 'string') {
      errors.push({
        field: 'details.reasoning',
        message: 'Model-inferred scores must include reasoning in details',
      })
    }
  }

  // Rule 4: Non-unavailable scores must have data sources
  if (score.confidence !== 'unavailable' && score.data_sources.length === 0) {
    errors.push({
      field: 'data_sources',
      message: `${score.confidence} scores must have at least one data source`,
    })
  }

  // Rule 5: No internal pipeline values in data_sources
  const internalValues = new Set(['cache', 'not_found', 'error', 'unknown', 'none', ''])
  const invalidSources = score.data_sources.filter(s => internalValues.has(s))
  if (invalidSources.length > 0) {
    errors.push({
      field: 'data_sources',
      message: `data_sources contains internal pipeline values: ${invalidSources.join(', ')}`,
    })
  }

  return errors
}

/**
 * Validate an array of PrincipleScores.
 * 
 * @returns Map of principle_number to validation errors
 */
export function validateScores(scores: PrincipleScore[]): Map<number, ProvenanceValidationError[]> {
  const errorMap = new Map<number, ProvenanceValidationError[]>()

  for (const score of scores) {
    const errors = validateScore(score)
    if (errors.length > 0) {
      errorMap.set(score.principle_number, errors)
    }
  }

  return errorMap
}

/**
 * Assert that a score is valid (throws if not).
 * Useful for testing and strict validation contexts.
 */
export function assertValidScore(score: PrincipleScore): void {
  const errors = validateScore(score)
  if (errors.length > 0) {
    const messages = errors.map(e => `${e.field}: ${e.message}`).join('\n  ')
    throw new Error(
      `Invalid PrincipleScore for P${score.principle_number}:\n  ${messages}`
    )
  }
}
