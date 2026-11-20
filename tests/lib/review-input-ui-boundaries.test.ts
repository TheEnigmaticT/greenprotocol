import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { validateParsedAnalysisInputs } from '@/lib/analysis-input-validation'
import WasteScoreCard from '@/components/WasteScoreCard'
import ScoreCard from '@/components/ScoreCard'
import type { AnalysisStep, DeterministicScores, WasteAnalysis } from '@/lib/types'

function steps(description = 'Add water.', quantity = '5 mL'): AnalysisStep[] {
  return [{ stepNumber: 1, description, conditions: { temperature: null, duration: null, atmosphere: null }, chemicals: [{ name: 'water', role: 'workup', quantity, quantityKg: null, quantityMl: null }] }]
}

const waste: WasteAnalysis = {
  summary: { grade: 'A', wasteImpactScore: 0, confidence: 'unavailable', primaryDriver: 'Missing measured waste.' },
  directWaste: { totalWasteKg: 0, solventWasteKg: 0, nonSolventWasteKg: 0 },
  hazardSegments: [], liquidBurden: { totalLiquidHandledKg: 0, totalLiquidDiscardedKg: 0 },
  processBurden: { transferCount: 0, vesselCount: 0, purificationCount: 0, washStepCount: 0, workflowComplexity: 0 },
  upstream: { lcaAvailable: false, notes: '' }, evidenceSources: [],
}

const scores: DeterministicScores = {
  scores: [
    { principle_number: 1, principle_name: 'Waste', score: -1, normalized: -1, max_score: 10, confidence: 'unavailable', details: {}, chemicals_flagged: [], data_sources: [] },
    { principle_number: 2, principle_name: 'Atom economy', score: 2, normalized: .2, max_score: 10, confidence: 'calculated', details: {}, chemicals_flagged: [], data_sources: [] },
  ], total_score: 2, max_possible: 10, grade: 'A',
  coverage: { assessed: 12, total: 12, unavailable: 0, partial: false },
  smiles_extraction: {}, yield_extraction: {},
}

describe('reviewed scope and process-use boundaries', () => {
  it.each([
    'For variant A, add 5 mL water. For variant B, add 20 mL water.',
    'Recipe 1: add 5 mL water. Recipe 2: add 20 mL water.',
    'For run 1, add 5 mL water. For run 2, add 20 mL water.',
    'Compare two formulation using different amounts.',
    'For Pb-n1, add 5 mL water. For Pb-n2, add 20 mL water.',
  ])('holds explicitly parallel recipes: %s', source => {
    expect(validateParsedAnalysisInputs(steps(), source).requiresReview).toBe(true)
  })
  it('does not call ordinary sequential additions separate formulations', () => {
    expect(validateParsedAnalysisInputs(steps(), 'Add 5 mL water. Add a further 20 mL water.').requiresReview).toBe(false)
  })
  it('does not mislabel a dual-unit quantity as parallel recipes', () => {
    const result = validateParsedAnalysisInputs(steps('Add water.', '10 g and 25 mL'), 'Add water, reported as 10 g and 25 mL.')
    expect(result.requiresReview).toBe(false)
    expect(result.warnings.join(' ')).toMatch(/compound quantity/i)
    expect(result.steps[0].chemicals[0].quantity).toBe('10 g and 25 mL')
  })
  it('applies a source-supported wash hint and rejects the contradictory model annotation', () => {
    const input = steps('Wash the organic layer with water.')
    input[0].chemicals[0].processUse = 'quench'
    const result = validateParsedAnalysisInputs(input, 'Wash the organic layer with water.')
    expect(result.steps[0].chemicals[0]).toMatchObject({ role: 'workup', processUse: 'wash' })
    expect(input[0].chemicals[0].processUse).toBe('quench')
  })
  it('removes an operation annotation supported only by a hallucinated description', () => {
    const input = steps('Wash the organic layer with water.')
    input[0].chemicals[0].processUse = 'wash'
    const result = validateParsedAnalysisInputs(input, 'Add water to the vial.')
    expect(result.steps[0].chemicals[0].processUse).toBeUndefined()
  })
})

describe('reviewed display boundaries', () => {
  it('does not show an unavailable legacy waste value as 0/10 or grade A', () => {
    const html = renderToStaticMarkup(createElement(WasteScoreCard, { wasteAnalysis: waste }))
    expect(html).not.toContain('0/10')
    expect(html).not.toMatch(/>A</)
    expect(html).toContain('INCOMPLETE')
  })
  it('does not call an explicitly calculated zero mass unavailable', () => {
    const measured = { ...waste, summary: { ...waste.summary, confidence: 'calculated' as const } }
    const html = renderToStaticMarkup(createElement(WasteScoreCard, { wasteAnalysis: measured }))
    expect(html).not.toMatch(/mass unavailable/i)
    expect(html).toContain('0/10')
  })
  it('reconciles stale coverage using the actual principle rows', () => {
    const html = renderToStaticMarkup(createElement(ScoreCard, { scores }))
    expect(html).toContain('1 of 2 principles assessed')
    expect(html).not.toContain('12 of 12')
    expect(html).toContain('INCOMPLETE')
    expect(html).not.toMatch(/>A</)
  })
})
