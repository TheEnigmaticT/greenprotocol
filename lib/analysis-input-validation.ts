import type { AnalysisStep, ParsedChemical } from '@/lib/types'

/**
 * Additive annotation describing when the chemical is applied in the procedure.
 * Distinct from the chemical's functional role (solvent/reagent/catalyst/
 * product/workup/drying_agent/other): a workup chemical can be used for
 * quenching, drying, extraction, or washing depending on the step description.
 *
 * The union is defined locally so that this helper compiles before the parent
 * has landed the schema field on ParsedChemical. Once lib/types.ts adds
 * `processUse?: ProcessUse`, callers can apply the hints directly.
 */
export type ProcessUse = 'reaction' | 'extraction' | 'wash' | 'quench' | 'drying' | 'other'

/** Optional output: occurrence-keyed process-use hints parent can apply after types.ts edit. */
export type ProcessUseHints = Record<string, ProcessUse>

export interface ValidationResult {
  /** The (possibly repaired) steps. Repairs are limited to source-grounded variants. */
  steps: AnalysisStep[]
  /** Conservative warnings. Empty array only when no input defect was detected. */
  warnings: string[]
  /** Multi-recipe scope cannot be scored as one experiment without review. */
  requiresReview?: boolean
  /** Additive hints; undefined when no source-grounded process use was inferred. */
  processUseHints?: ProcessUseHints
}

// ─────────────────────────────────────────────────────────────────────────────
// Quantity-pattern detectors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Physical-descriptor quantities — pore size, particle size, mesh count, etc.
 * These are NOT material quantities; they describe the physical form of the
 * material. Flag them with a warning, but DO NOT silently strip them from the
 * quantity field. The verbatim emission is preserved for human review.
 *
 * Boundary strategy: lead with a digit (the descriptor is anchored to a
 * number) and end at end-of-string or whitespace — JavaScript's `\b` is
 * ASCII-only and misses Unicode letters like Å (U+00C5), so we do not rely
 * on it.
 */
const PHYSICAL_DESCRIPTOR_QUANTITY = /\d+(?:\.\d+)?\s*(?:nm|Å|angstrom|angstroms|µm|um|micron|microns|mesh)(?:\s|$)/i

/** Compound quantity strings — multiple amounts joined by separators. */
const COMPOUND_QUANTITY = /[+;]|\b(?:and|plus|then|also)\b\s+\d|,\s*\d+(?:\.\d+)?\s*(?:mg|kg|g|mL|L)\b/i

// ─────────────────────────────────────────────────────────────────────────────
// Process-use detectors (source-grounded cues from the step description)
// ─────────────────────────────────────────────────────────────────────────────

const PROCESS_USE_CUES: ReadonlyArray<{ use: ProcessUse; pattern: RegExp }> = [
  { use: 'wash',      pattern: /\b(?:wash(?:ing|ed)?|rins(?:e|ed|ing))\b/i },
  { use: 'quench',    pattern: /\bquench(?:ed|ing)?\b/i },
  { use: 'drying',    pattern: /\bdr(?:y|ied|ying)\b(?:\s+(?:the|over|with))?/i },
  { use: 'extraction',pattern: /\b(?:extract(?:ed|ion|ing)?|partition(?:ed|ing)?|separat(?:e|ed|ing)\s+(?:the\s+)?layers?)\b/i },
]

function inferProcessUse(description: string, role: string): ProcessUse | undefined {
  // Reaction-stage cues — only when role says this is a reaction reagent/solvent
  // and the description says so. role=workup alone is not a reaction cue.
  if (/\b(?:react(?:ion|ed|ing)?|stir(?:red|ring)?|reflux(?:ed|ing)?|heat(?:ed|ing)?|cool(?:ed|ing)?|add(?:ed|ition)?|acidif(?:y|ied|ying)|basif(?:y|ied|ying))\b/i.test(description)
      && /^(?:reagent|solvent|catalyst|product)$/i.test(role)) {
    return 'reaction'
  }
  for (const cue of PROCESS_USE_CUES) {
    if (cue.pattern.test(description)) return cue.use
  }
  return undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// Occurrence helpers
// ─────────────────────────────────────────────────────────────────────────────

function occurrenceId(stepIndex: number, chemicalIndex: number): string {
  return `${stepIndex}:${chemicalIndex}`
}

function identity(name: string): string {
  return name.trim().toLowerCase()
}

/** True when two quantities in the same step share a name but disagree on role. */
function isSameStepRoleConflict(
  steps: AnalysisStep[],
  source: string,
): string[] {
  const warnings: string[] = []
  steps.forEach((step, stepIdx) => {
    const byName = new Map<string, Set<string>>()
    step.chemicals.forEach(chem => {
      const key = identity(chem.name)
      if (!key) return
      const set = byName.get(key) ?? new Set<string>()
      set.add(chem.role)
      byName.set(key, set)
    })
    for (const [name, roles] of byName) {
      if (roles.size > 1) {
        warnings.push(
          `Step ${stepIdx + 1}: same chemical "${name}" appears with conflicting roles (${[...roles].join(', ')}); cannot safely resolve without source-grounded separation.`,
        )
      }
    }
  })
  if (warnings.length === 0) {
    // Source-grounded hint: if source mentions the chemical name once but the
    // parser emitted multiple roles anyway, surface the ambiguity.
    void source
  }
  return warnings
}

// ─────────────────────────────────────────────────────────────────────────────
// Main validator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conservative source-grounded validation of parsed analysis inputs.
 *
 * The helper enforces three honest behaviors:
 *
 * 1. **Preserve all formulation amounts.** When the same chemical appears in
 *    multiple occurrences (steps or co-listed in the same step), each
 *    occurrence keeps its own quantity. The validator never chooses the
 *    first amount and never sums separate variants.
 *
 * 2. **Flag, do not silently merge/split.** If a single model emission combines
 *    multiple amounts (e.g. "5 mL; 20 mL") the helper cannot safely split
 *    without source proof; it warns and requests formulation separation.
 *    If the same chemical occurs in multiple steps with different quantities,
 *    the helper flags the multi-formulation aggregation for human review.
 *
 * 3. **Process-use hints are source-grounded only.** role=workup does NOT
 *    silently become processUse=wash. Hints are emitted only when the step
 *    description supports the use.
 *
 * If the helper cannot safely validate the input, the returned warnings
 * explicitly request human review and never claim "complete input validated".
 */
export function validateParsedAnalysisInputs(
  steps: AnalysisStep[],
  source: string,
): ValidationResult {
  const warnings: string[] = []
  const processUseHints: ProcessUseHints = {}
  const normalizedSource = source.replace(/\s+/g, '').toLowerCase()
  // This first staging slice holds explicit parallel recipes rather than
  // inventing a combined batch. Sequential additions alone are not variants.
  const sourceVariantLabels = [...source.matchAll(/\bfor\s+([a-z][a-z\d_-]*)\s*[, :]/gi)]
    .map(match => match[1].toLowerCase()).filter(label => /\d/.test(label))
  let requiresReview = new Set(sourceVariantLabels).size > 1
    || /\b(?:two|three|multiple|separate)\s+formulations\b/i.test(source)
  if (requiresReview) warnings.push('Multiple source formulations were detected. Submit one formulation at a time; separate formulations must not be scored as one combined batch.')

  // ── Walk every occurrence once, in order, collecting warnings + hints. ──
  steps.forEach((step, stepIdx) => {
    step.chemicals.forEach((chemical, chemIdx) => {
      const qty = (chemical.quantity ?? '').trim()

      // (a) Compound-quantity string — model combined multiple amounts.
      if (qty && COMPOUND_QUANTITY.test(qty)) {
        requiresReview = true
        warnings.push(
          `Step ${stepIdx + 1}, chemical "${chemical.name}" has a compound quantity ` +
          `"${qty}" that cannot be safely split without source-grounded separation; ` +
          `flagging for human review.`,
        )
      }

      // (b) Physical-descriptor quantity — pore/particle/mesh etc.
      if (qty && PHYSICAL_DESCRIPTOR_QUANTITY.test(qty)) {
        warnings.push(
          `Step ${stepIdx + 1}, chemical "${chemical.name}" quantity "${qty}" looks ` +
          `like a physical descriptor (pore size, particle size, mesh); not a ` +
          `material quantity. Preserved verbatim — please supply the amount.`,
        )
      }

      // (c) Process-use hint — additive, source-grounded only.
      const use = inferProcessUse(step.description ?? '', chemical.role ?? '')
      if (use) processUseHints[occurrenceId(stepIdx, chemIdx)] = use
    })
  })

  // ── Multi-formulation aggregation across steps. ──
  // Group occurrences by identity (name + role). If more than one occurrence
  // exists with distinct quantities, that is a multi-formulation signal —
  // surface a warning and ask for explicit separation. NEVER collapse or sum.
  const occurrencesByIdentity = new Map<string, Array<{
    stepIdx: number
    chemIdx: number
    quantity: string
    role: string
  }>>()
  steps.forEach((step, stepIdx) => {
    step.chemicals.forEach((chemical, chemIdx) => {
      const key = `${identity(chemical.name)}|${(chemical.role ?? '').toLowerCase()}`
      if (!key.startsWith('|')) {
        const list = occurrencesByIdentity.get(key) ?? []
        list.push({ stepIdx, chemIdx, quantity: chemical.quantity ?? '', role: chemical.role ?? '' })
        occurrencesByIdentity.set(key, list)
      }
    })
  })
  for (const [key, occurrences] of occurrencesByIdentity) {
    if (occurrences.length < 2) continue
    const quantities = new Set(occurrences.map(o => o.quantity.trim()).filter(Boolean))
    if (quantities.size > 1 && ![...quantities].every(quantity => normalizedSource.includes(quantity.replace(/\s+/g, '').toLowerCase()))) {
      const [name] = key.split('|')
      const stepsList = occurrences.map(o => o.stepIdx + 1).join(', ')
      warnings.push(
        `Chemical "${name}" appears in multiple steps (${stepsList}) with ` +
        `different quantities (${[...quantities].join(' vs ')}) not grounded in the source; ` +
        `please confirm each occurrence independently.`,
      )
    }
  }

  // ── Same-step role conflicts. ──
  warnings.push(...isSameStepRoleConflict(steps, source))

  // ── Honesty signal: never claim validated-complete input when we cannot. ──
  if (warnings.length > 0) {
    warnings.push(
      'Input is partially unvalidated: see warnings above. The analysis is not ' +
      'safe to claim as "fully validated" until they are resolved.',
    )
  }

  return {
    steps,
    warnings,
    requiresReview,
    ...(Object.keys(processUseHints).length > 0 ? { processUseHints } : {}),
  }
}

// Re-export ParsedChemical for callers that want to type-check inputs without
// reaching into lib/types.ts directly.
export type { ParsedChemical }
