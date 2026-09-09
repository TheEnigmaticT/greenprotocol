import { describe, expect, it } from 'vitest'
import { groundDeclaredProducts } from '@/lib/declared-products'
import type { AnalysisStep } from '@/lib/types'

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
