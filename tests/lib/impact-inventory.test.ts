import { describe, expect, it } from 'vitest'
import { buildImpactInventory, buildUnavailableImpact } from '@/lib/impact-inventory'
import type { AnalysisResult } from '@/lib/types'

const supportedSwap = {
  stepNumber: 1,
  principleNumbers: [5],
  principleNames: ['Safer Solvents'],
  severity: 'high' as const,
  kind: 'chemical_swap' as const,
  original: { chemical: 'dichloromethane', issue: 'hazardous solvent' },
  alternative: { chemical: 'ethyl acetate', rationale: 'candidate', yieldImpact: '', caveats: '', evidenceBasis: '' },
  confidenceLevel: 'medium' as const,
  applicationEligibility: { status: 'supported' as const, reason: 'Reaction-applicable evidence fixture.' },
}

function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    protocolTitle: 'Inventory fixture',
    chemistrySubdomain: 'synthetic',
    steps: [{
      stepNumber: 1,
      description: 'Extract product.',
      chemicals: [
        { name: 'dichloromethane', role: 'solvent', quantity: '25 mL', quantityMl: 25, quantityKg: 0.033 },
        { name: 'sodium sulfate', role: 'drying agent', quantity: 'as needed', quantityMl: null, quantityKg: null },
      ],
      conditions: { temperature: null, duration: null, atmosphere: null },
    }],
    recommendations: [supportedSwap],
    revisedProtocol: '',
    overallAssessment: {
      greenPrinciplesViolated: [5], mostImpactfulChange: 'replace solvent', experimentalValidationNeeded: true, disclaimer: '',
    },
    enrichedChemicals: [{
      name: 'dichloromethane', role: 'solvent', quantity: '25 mL', quantityMl: 25, quantityKg: 0.033,
      data_source: 'chemistry-service:PubChem', reference_status: 'available',
    }],
    ...overrides,
  }
}

describe('buildImpactInventory', () => {
  it('preserves parsed baseline quantities and makes supported replacement quantities explicitly unknown', () => {
    const inventory = buildImpactInventory(analysis())

    expect(inventory.version).toBe('impact-inventory/v1')
    expect(inventory.baselineRows).toMatchObject([
      { chemical: 'dichloromethane', quantity: { state: 'known', massKg: 0.033, volumeMl: 25 }, provenance: expect.arrayContaining(['model_extracted_protocol', 'chemistry-service:PubChem']) },
      { chemical: 'sodium sulfate', quantity: { state: 'unknown' } },
    ])
    expect(inventory.afterRows).toEqual(expect.arrayContaining([expect.objectContaining({
      chemical: 'ethyl acetate',
      originalChemical: 'dichloromethane',
      quantity: { state: 'unknown' },
      scenario: 'proposed',
      evidenceEligibility: 'supported',
    })]))
    expect(inventory.missingInputs).toEqual(expect.arrayContaining([
      expect.stringContaining('sodium sulfate'),
      expect.stringContaining('Replacement quantity for dichloromethane → ethyl acetate'),
      expect.stringContaining('product output or yield'),
      expect.stringContaining('Substitution-specific impact factors'),
    ]))
  })

  it('excludes process and analytical recommendations and records why no comparison can be made', () => {
    const inventory = buildImpactInventory(analysis({
      recommendations: [
        { ...supportedSwap, kind: 'process_change', alternative: { ...supportedSwap.alternative, chemical: 'reduce solvent volume' } },
        { ...supportedSwap, kind: 'analytical', alternative: { ...supportedSwap.alternative, chemical: 'monitor by TLC' } },
      ],
    }))

    expect(inventory.afterRows).toHaveLength(2)
    expect(inventory.afterRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ chemical: 'dichloromethane', scenario: 'proposed' }),
      expect.objectContaining({ chemical: 'sodium sulfate', scenario: 'proposed' }),
    ]))
    expect(inventory.missingInputs).toContain('No evidence-supported chemical substitution is available for impact comparison.')
  })

  it('only includes accepted supported swaps in an accepted scenario', () => {
    const inventory = buildImpactInventory(analysis({
      recommendations: [{ ...supportedSwap, isAccepted: true }, { ...supportedSwap, stepNumber: 2, isAccepted: false }],
    }), 'accepted')

    expect(inventory.afterRows).toHaveLength(2)
    expect(inventory.afterRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ scenario: 'accepted', chemical: 'ethyl acetate' }),
      expect.objectContaining({ scenario: 'accepted', chemical: 'sodium sulfate' }),
    ]))
  })

  it('does not treat zero or negative parser values as known submitted quantities', () => {
    const inventory = buildImpactInventory(analysis({
      steps: [{
        stepNumber: 1,
        description: 'Malformed extracted quantities.',
        chemicals: [
          { name: 'zero quantity', role: 'solvent', quantity: '', quantityKg: 0, quantityMl: 0 },
          { name: 'negative quantity', role: 'reagent', quantity: '-2 g', quantityKg: -0.002, quantityMl: -2 },
        ],
        conditions: { temperature: null, duration: null, atmosphere: null },
      }],
    }))

    expect(inventory.baselineRows).toMatchObject([
      { chemical: 'zero quantity', quantity: { state: 'unknown' } },
      { chemical: 'negative quantity', quantity: { state: 'unknown', declaredText: '-2 g' } },
    ])
    expect(inventory.missingInputs).toEqual(expect.arrayContaining([
      expect.stringContaining('non-positive'),
    ]))
  })

  it('keeps unchanged baseline materials in the after scenario without retaining a swapped original', () => {
    const inventory = buildImpactInventory(analysis())

    expect(inventory.afterRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ chemical: 'sodium sulfate', scenario: 'proposed' }),
      expect.objectContaining({ chemical: 'ethyl acetate', originalChemical: 'dichloromethane', scenario: 'proposed' }),
    ]))
    expect(inventory.afterRows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ chemical: 'dichloromethane', scenario: 'proposed' }),
    ]))
  })

  it('builds an explicitly unavailable accepted impact snapshot instead of numeric zero savings', () => {
    const impact = buildUnavailableImpact(analysis({
      recommendations: [{ ...supportedSwap, isAccepted: true }],
    }), 'accepted')

    expect(impact).toMatchObject({
      co2eSavedKg: 0,
      hazardousWasteEliminatedKg: 0,
      assessment: { level: 'unavailable' },
      inventory: { afterRows: expect.arrayContaining([
        expect.objectContaining({ chemical: 'ethyl acetate', scenario: 'accepted' }),
      ]) },
    })
  })
})
