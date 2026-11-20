import { describe, expect, it } from 'vitest'
import { validateParsedAnalysisInputs } from '@/lib/analysis-input-validation'
import type { AnalysisStep } from '@/lib/types'

function step(amount: string, description: string): AnalysisStep {
  return { stepNumber: 1, description, conditions: { temperature: null, duration: null, atmosphere: null }, chemicals: [{ name: 'water', role: 'solvent', quantity: amount, quantityMl: null, quantityKg: null }] }
}

describe('protocol scope boundary', () => {
  it('does not label sequential solvent additions as separate formulations', () => {
    const steps = [step('5 mL', 'Add 5 mL water.'), { ...step('20 mL', 'Add a further 20 mL water.'), stepNumber: 2 }]
    const result = validateParsedAnalysisInputs(steps, 'Add 5 mL water. Add a further 20 mL water.')
    expect(result.warnings.some(warning => /separate formulations/i.test(warning))).toBe(false)
  })
  it('requires scope review for amounts merged across explicitly labelled variants', () => {
    const source = 'For sample-1, add 5 mL water. For sample-2, add 20 mL water.'
    const result = validateParsedAnalysisInputs([step('5 mL (sample-1), 20 mL (sample-2)', source)], source)
    expect(result.requiresReview).toBe(true)
    expect(result.warnings.join(' ')).toMatch(/one formulation|separate.*formulation/i)
  })
  it('holds multiple source formulations even when extraction separated their quantities', () => {
    const source = 'For sample-1, add 5 mL water. For sample-2, add 20 mL water.'
    const result = validateParsedAnalysisInputs([step('5 mL', 'Prepare sample-1.'), { ...step('20 mL', 'Prepare sample-2.'), stepNumber: 2 }], source)
    expect(result.requiresReview).toBe(true)
  })
})
