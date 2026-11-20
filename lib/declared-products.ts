import type { AnalysisStep } from '@/lib/types'

// Narrow alpha typography equivalence: Greek small letter alpha (U+03B1) and
// Latin small letter alpha (U+0251) are typographic variants of the same
// Greek-letter symbol commonly used in chemical nomenclature (e.g. α-tocopherol).
// Both fonts are observed in the same protocol corpus (Latin alpha in some
// sources, Greek alpha in others), and the parser/model may emit either form
// regardless of which the source uses. Without equivalence, an explicitly
// declared product was being dropped from the declared inventory.
//
// The only explicit typography equivalence added here is alpha at positions
// where the chemical name contains it. Matching remains Unicode case-insensitive;
// source text and chemical identities are never rewritten or globally normalized.
// This does not equate beta with alpha, Cyrillic letters with Latin letters, or R/S.
const GREEK_ALPHA = '\u03B1'
const LATIN_ALPHA = '\u0251'
const ALPHA_TYPOGRAPHY_CLASS = `[${GREEK_ALPHA}${LATIN_ALPHA}]`
const ALPHA_ANY = new RegExp(`[${GREEK_ALPHA}${LATIN_ALPHA}]`, 'g')

/** Build a regex source string for the chemical name with alpha-typography equivalence. */
function escapeNameForGrounding(name: string): string {
  // First escape regex metacharacters so the name's literal characters survive.
  // Then replace every alpha position (Greek OR Latin) with a character class
  // so either typography can match the source span. The replacement is a single
  // combined pass — sequencing two passes would re-feed inserted Latin alphas
  // into the second pass and nest the class. The original name spelling is
  // preserved on the chemical record; only the matching pattern is widened.
  return name
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(ALPHA_ANY, ALPHA_TYPOGRAPHY_CLASS)
}

/** A predicted product must not become a declared inventory item. */
export function groundDeclaredProducts(steps: AnalysisStep[], protocolText: string) {
  const source = protocolText.replace(/\s+/g, ' ')
  const warnings: string[] = []
  const groundedSteps = steps.map(step => ({
    ...step,
    chemicals: step.chemicals.filter(chemical => {
      if (chemical.role !== 'product') return true
      const name = chemical.name.trim().replace(/\s+/g, ' ')
      const escaped = escapeNameForGrounding(name)
      const explicitlyNamed = name
        && escaped
        && new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(source)
      if (explicitlyNamed) return true
      warnings.push(`Product "${chemical.name}" was not explicitly named in the source and was excluded from the declared inventory. Any reaction product prediction remains model-inferred.`)
      return false
    }),
  }))
  return { steps: groundedSteps, warnings }
}
