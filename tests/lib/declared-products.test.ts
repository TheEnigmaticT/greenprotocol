import { describe, expect, it } from 'vitest'
import { groundDeclaredProducts } from '@/lib/declared-products'
import type { AnalysisStep } from '@/lib/types'

const LATIN_ALPHA = '\u0251' // ɑ — Latin small letter alpha (legacy typography)
const GREEK_ALPHA = '\u03B1' // α — Greek small letter alpha (common typography)

function steps(name: string): AnalysisStep[] {
  return [{ stepNumber: 1, description: 'Isolate material.', conditions: { temperature: null, duration: null, atmosphere: null }, chemicals: [
    { name: 'methanol', role: 'solvent', quantity: '', quantityMl: null, quantityKg: null },
    { name, role: 'product', quantity: '', quantityMl: null, quantityKg: null },
  ] }]
}

describe('declared product source authority', () => {
  it('does not promote an inferred named ester into a declared product', () => {
    const result = groundDeclaredProducts(steps('4-hydroxybenzoic acid methyl ester'), 'Extract the ester with ethyl acetate.')
    expect(result.steps[0].chemicals.map(c => c.name)).toEqual(['methanol'])
    expect(result.warnings[0]).toContain('not explicitly named')
  })
  it('retains a product actually named in the source', () => {
    const result = groundDeclaredProducts(steps('cinnamic acid'), 'Collect the precipitated cinnamic acid by filtration.')
    expect(result.steps[0].chemicals).toHaveLength(2)
    expect(result.warnings).toEqual([])
  })
  it('does not match a shorter chemical name inside a different compound', () => {
    expect(groundDeclaredProducts(steps('salicylic acid'), 'Isolate acetylsalicylic acid.').steps[0].chemicals).toHaveLength(1)
  })
  it('allows presentation case and whitespace differences without changing the name', () => {
    const result = groundDeclaredProducts(steps('Cinnamic Acid'), 'Isolate CINNAMIC\nACID.')
    expect(result.steps[0].chemicals[1].name).toBe('Cinnamic Acid')
  })
})

describe('declared product alpha typography grounding (narrow audit)', () => {
  // Reproduces the observed bug: source contains Latin alpha U+0251, parser
  // emits Greek alpha U+03B1 (or vice versa). A literal-character regex ground
  // check would drop the explicitly-named product from the declared inventory.
  it('grounds Greek-alpha product name against Latin-alpha source span', () => {
    const productName = `${GREEK_ALPHA}-tocopherol`
    const source = `Isolate the purified ${LATIN_ALPHA}-tocopherol by trituration.`
    const result = groundDeclaredProducts(steps(productName), source)
    expect(result.steps[0].chemicals).toHaveLength(2)
    expect(result.warnings).toEqual([])
  })
  it('grounds Latin-alpha product name against Greek-alpha source span', () => {
    const productName = `D-${LATIN_ALPHA}-tocopherol`
    const source = `Isolate the purified D-${GREEK_ALPHA}-tocopherol by trituration.`
    const result = groundDeclaredProducts(steps(productName), source)
    expect(result.steps[0].chemicals).toHaveLength(2)
    expect(result.warnings).toEqual([])
  })
  it('preserves the model-emitted spelling on the chemical record (does not rewrite)', () => {
    const productName = `${GREEK_ALPHA}-tocopherol`
    const source = `Isolate the purified ${LATIN_ALPHA}-tocopherol by trituration.`
    const result = groundDeclaredProducts(steps(productName), source)
    expect(result.steps[0].chemicals[1].name).toBe(productName)
  })

  // Negative cases — the typography equivalence must remain narrow.
  it('does NOT fold arbitrary Greek letters (beta/gamma) into Latin lookalikes', () => {
    // β is Greek beta U+03B2; there is no Latin counterpart, but verify the
    // grounding does not silently conflate unrelated characters.
    const productName = `${GREEK_ALPHA}-pinene` // Greek alpha present, but Latin lookalike absent
    const source = `Distill the fraction containing beta-pinene.` // "beta" as English word
    const result = groundDeclaredProducts(steps(productName), source)
    expect(result.steps[0].chemicals).toHaveLength(1)
    expect(result.warnings[0]).toContain('not explicitly named')
  })
  it('does NOT fold chemical hashes or alphanumeric tokens', () => {
    // A hash-like token (e.g., 'XK7-0491') has no typography ambiguity; the
    // grounding must still require literal presence in the source.
    const productName = 'compound XK7-0491'
    const source = 'The reaction mixture was concentrated; no isolated material was named.'
    const result = groundDeclaredProducts(steps(productName), source)
    expect(result.steps[0].chemicals).toHaveLength(1)
    expect(result.warnings[0]).toContain('not explicitly named')
  })
  it('does NOT silently change stereochemistry (R/S vs r/s)', () => {
    // (R)-configured compound should not be conflated with (r) — chirality is
    // semantic, not typography, and changing it would be a stereochemical edit.
    const productName = '(R)-BINOL'
    const source = 'Recrystallize the (S)-BINOL product from hot toluene.' // opposite chirality
    const result = groundDeclaredProducts(steps(productName), source)
    expect(result.steps[0].chemicals).toHaveLength(1)
    expect(result.warnings[0]).toContain('not explicitly named')
  })
  it('still does not match the chemical name when a different letter occupies the alpha slot in source', () => {
    // Greek alpha (U+03B1) must NOT fold into Greek beta (U+03B2) — they are
    // distinct letters even though both are Greek. Narrow alpha equivalence is
    // strictly alpha ↔ alpha, never alpha ↔ beta/gamma.
    const productName = `${GREEK_ALPHA}-pinene`
    const source = `The fraction contained β-pinene (beta-pinene).`
    const result = groundDeclaredProducts(steps(productName), source)
    expect(result.steps[0].chemicals).toHaveLength(1)
    expect(result.warnings[0]).toContain('not explicitly named')
  })
  it('does not match a Latin lookalike char that is NOT the alpha typography pair', () => {
    // Cyrillic small letter a (U+0430) is not part of the alpha typography pair.
    // It must not silently fold.
    const productName = `${GREEK_ALPHA}-amino acid`
    const source = 'Use аmino acid (Cyrillic а U+0430) as buffer.'
    const result = groundDeclaredProducts(steps(productName), source)
    expect(result.steps[0].chemicals).toHaveLength(1)
    expect(result.warnings[0]).toContain('not explicitly named')
  })
})
