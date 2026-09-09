import { describe, expect, it } from 'vitest'
import { prepareChemicalInputs } from '@/lib/chemical-inputs'
import type { AnalysisStep } from '@/lib/types'
import type { ConvertResult } from '@/lib/chemistry-service'

const steps = (): AnalysisStep[] => [
  { stepNumber: 1, description: 'Add water.', conditions: { temperature: null, duration: null, atmosphere: null }, chemicals: [{ name: 'water', role: 'solvent', quantity: '5 mL', quantityMl: 5, quantityKg: 99 }] },
  { stepNumber: 2, description: 'Wash with water.', conditions: { temperature: null, duration: null, atmosphere: null }, chemicals: [{ name: 'water', role: 'workup', quantity: '20 mL', quantityMl: 20, quantityKg: 88 }] },
]
function conversion(quantity: string, kg: number): ConvertResult {
  return { chemical_name: 'water', input_quantity: quantity, smiles: 'O', molecular_formula: 'H2O', molecular_weight: 18, density_g_per_ml: 1, quantity_g: kg * 1000, quantity_kg: kg, quantity_mol: kg * 1000 / 18, ghs_hazards: [], green_alternatives: [], citations: [], data_source: 'cache', cached: true, warnings: [], error: null }
}

describe('occurrence-local scoring inputs', () => {
  it('matches reordered same-name results by declared quantity, not first name', () => {
    const result = prepareChemicalInputs(steps(), { results: [conversion('20 mL', .020), conversion('5 mL', .005)] })
    expect(result.scoreChemicals.map(c => [c.quantity, c.quantity_kg, c.step_number, c.role])).toEqual([
      ['5 mL', .005, 1, 'solvent'], ['20 mL', .020, 2, 'workup'],
    ])
    expect(result.scoreChemicals.every(c => c.smiles === 'O')).toBe(true)
    expect(result.scoreChemicals.every(c => c.reference_smiles === 'O' && c.reference_provenance === 'cache')).toBe(true)
    expect(result.unresolvedChemicals.size).toBe(0)
  })
  it('never copies model-estimated mass into a missing conversion occurrence', () => {
    const result = prepareChemicalInputs(steps(), { results: [conversion('20 mL', .020)] })
    expect(result.scoreChemicals[0].quantity_kg).toBeNull()
    expect(result.scoreChemicals[1].quantity_kg).toBe(.020)
    expect(result.unresolvedChemicals.has('water')).toBe(true)
  })
  it('rejects mismatched names instead of using array position', () => {
    const wrong = { ...conversion('5 mL', .005), chemical_name: 'ethanol', smiles: 'CCO' }
    const result = prepareChemicalInputs(steps(), { results: [wrong] })
    expect(result.scoreChemicals.every(c => c.smiles === null && c.quantity_kg === null)).toBe(true)
  })
  it('retains an indefinite material without assigning a molecular structure', () => {
    const input = steps().slice(0, 1)
    input[0].chemicals[0].name = 'brine'
    const response = { ...conversion('5 mL', .005), chemical_name: 'brine', data_source: 'indefinite', smiles: null, molecular_weight: null }
    const result = prepareChemicalInputs(input, { results: [response] })
    expect(result.indefiniteChemicals.has('brine')).toBe(true)
    expect(result.scoreChemicals[0].smiles).toBeNull()
    expect(result.scoreChemicals[0].reference_status).toBe('indefinite')
  })
  it('does not invent a quantity when the source did not state one', () => {
    const input = steps().slice(0, 1)
    input[0].chemicals[0].quantity = ''
    const result = prepareChemicalInputs(input, { results: [conversion('', .005)] })
    expect(result.scoreChemicals[0].quantity_kg).toBeNull()
    expect(result.scoreChemicals[0].quantity_mol).toBeNull()
  })
})
