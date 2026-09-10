import { describe, expect, it } from 'vitest'
import type { Recommendation } from '@/lib/types'
import {
  classifyInventoryChemical,
  collectHazardousInventory,
  countChemicalSwaps,
  shouldRepairChemicalSwaps,
} from '@/lib/hazardous-inventory'

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const {
    original: originalOverride,
    alternative: alternativeOverride,
    ...rest
  } = overrides
  return {
    stepNumber: 1,
    principleNumbers: [5],
    principleNames: ['Safer Solvents'],
    severity: 'medium',
    confidenceLevel: 'medium',
    original: {
      chemical: 'dichloromethane',
      issue: 'hazardous solvent',
      ...(originalOverride ?? {}),
    },
    alternative: {
      chemical: 'ethyl acetate',
      rationale: 'greener solvent',
      yieldImpact: 'comparable',
      caveats: '',
      evidenceBasis: 'CHEM21',
      ...(alternativeOverride ?? {}),
    },
    ...rest,
  }
}

describe('classifyInventoryChemical / collectHazardousInventory', () => {
  it('flags corrosive mineral acids by name even when absent from CHEMICALS DB', () => {
    const item = classifyInventoryChemical({
      name: 'concentrated phosphoric acid',
      role: 'catalyst',
      stepNumber: 2,
    })
    expect(item).not.toBeNull()
    expect(item!.classes).toContain('corrosive_mineral_acid')
  })

  it('flags anhydrides / acylating agents without protocol-specific hardcodes', () => {
    const item = classifyInventoryChemical({ name: 'acetic anhydride', role: 'reagent' })
    expect(item).not.toBeNull()
    expect(item!.classes).toContain('anhydride_acylating')
    expect(item!.classes.some((c) => c === 'ghs_severe' || c === 'anhydride_acylating')).toBe(true)
  })

  it('flags chlorinated solvents via name + chem21', () => {
    const item = classifyInventoryChemical({ name: 'DCM', role: 'solvent' })
    expect(item).not.toBeNull()
    expect(item!.classes).toEqual(
      expect.arrayContaining(['chlorinated_solvent', 'chem21_hazardous']),
    )
  })

  it('flags hazardous solvents (DMF, hexane, diethyl ether)', () => {
    for (const name of ['DMF', 'hexane', 'diethyl ether']) {
      const item = classifyInventoryChemical({ name, role: 'solvent' })
      expect(item, name).not.toBeNull()
      expect(
        item!.classes.some((c) =>
          ['hazardous_solvent', 'chem21_hazardous', 'ghs_severe'].includes(c),
        ),
        name,
      ).toBe(true)
    }
  })

  it('flags identifiable heavy-metal catalysts', () => {
    const item = classifyInventoryChemical({
      name: 'Pd(PPh3)4',
      role: 'catalyst',
    })
    expect(item).not.toBeNull()
    expect(item!.classes).toContain('toxic_heavy_metal_catalyst')
  })

  it('uses enrichment GHS codes when present', () => {
    const item = classifyInventoryChemical(
      { name: 'mystery-reagent-x' },
      {
        name: 'mystery-reagent-x',
        role: 'reagent',
        quantity: '',
        quantityMl: null,
        quantityKg: null,
        ghs_hazards: [{ code: 'H350', description: 'May cause cancer', source: 'test' }],
      },
    )
    expect(item).not.toBeNull()
    expect(item!.classes).toContain('ghs_severe')
    expect(item!.signals.some((s) => s.includes('H350'))).toBe(true)
  })

  it('does not flag benign / CHEM21-recommended inventory chemicals', () => {
    for (const name of ['water', 'salicylic acid', 'sodium chloride', 'ethanol', 'ethyl acetate', '2-MeTHF']) {
      const item = classifyInventoryChemical({ name })
      expect(item, name).toBeNull()
    }
  })

  it('collects unique hazardous inventory from steps', () => {
    const items = collectHazardousInventory([
      { name: 'acetic anhydride', stepNumber: 2, role: 'reagent' },
      { name: 'Acetic Anhydride', stepNumber: 2, role: 'reagent' },
      { name: 'water', stepNumber: 4, role: 'solvent' },
      { name: 'concentrated phosphoric acid', stepNumber: 2, role: 'catalyst' },
    ])
    const names = items.map((i) => i.name.toLowerCase())
    expect(names).toContain('acetic anhydride')
    expect(names).toContain('concentrated phosphoric acid')
    expect(names).not.toContain('water')
    expect(items.length).toBe(2)
  })
})

describe('shouldRepairChemicalSwaps gate', () => {
  it('shouldRepair when hazardous inventory present and zero chemical_swap', () => {
    const tipsOnly: Recommendation[] = [
      makeRec({
        kind: 'process_change',
        original: { chemical: 'acetic anhydride', issue: 'excess' },
        alternative: {
          chemical: 'acetic anhydride (reduced quantity)',
          rationale: 'cut dose',
          yieldImpact: 'may lower conversion',
          caveats: '',
          evidenceBasis: 'atom economy',
        },
      }),
      makeRec({
        kind: 'analytical',
        original: { chemical: 'reaction mixture', issue: 'endpoint unclear' },
        alternative: {
          chemical: 'TLC',
          rationale: 'monitor conversion',
          yieldImpact: 'n/a',
          caveats: '',
          evidenceBasis: 'lab practice',
        },
      }),
    ]
    const hazardous = collectHazardousInventory([
      { name: 'acetic anhydride' },
      { name: 'phosphoric acid' },
    ])
    expect(countChemicalSwaps(tipsOnly)).toBe(0)
    expect(hazardous.length).toBeGreaterThan(0)
    expect(
      shouldRepairChemicalSwaps({
        recommendations: tipsOnly,
        hazardousInventory: hazardous,
      }),
    ).toBe(true)
  })

  it('repairs when a hazardous non-solvent catalyst has only a soft loading tip', () => {
    const tipsOnly = [makeRec({
      kind: 'process_change',
      original: { chemical: 'Pd(PPh3)4', issue: 'precious-metal catalyst' },
      alternative: {
        chemical: 'Pd(PPh3)4', rationale: 'Reduce catalyst loading after screening',
        yieldImpact: 'requires validation', caveats: '', evidenceBasis: 'optimization',
      },
    })]
    const hazardous = collectHazardousInventory([{ name: 'Pd(PPh3)4', role: 'catalyst' }])
    expect(hazardous[0]).toMatchObject({ name: 'Pd(PPh3)4', role: 'catalyst' })
    expect(shouldRepairChemicalSwaps({ recommendations: tipsOnly, hazardousInventory: hazardous })).toBe(true)
  })

  it('skips when chemical_swap already present (Suzuki-style)', () => {
    const withSwap = [
      makeRec({
        kind: 'chemical_swap',
        original: { chemical: 'DMF', issue: ' reprotoxic solvent' },
        alternative: {
          chemical: '2-MeTHF',
          rationale: 'greener solvent',
          yieldImpact: 'comparable',
          caveats: '',
          evidenceBasis: 'CHEM21',
        },
      }),
    ]
    const hazardous = collectHazardousInventory([
      { name: 'DMF' },
      { name: 'hexane' },
    ])
    expect(countChemicalSwaps(withSwap)).toBe(1)
    expect(
      shouldRepairChemicalSwaps({
        recommendations: withSwap,
        hazardousInventory: hazardous,
      }),
    ).toBe(false)
  })

  it('skips when inventory has no hazardous classes', () => {
    const tipsOnly: Recommendation[] = [
      makeRec({
        kind: 'process_change',
        original: { chemical: 'water', issue: 'heating' },
        alternative: {
          chemical: 'ambient temperature',
          rationale: 'save energy',
          yieldImpact: 'n/a',
          caveats: '',
          evidenceBasis: 'P6',
        },
      }),
    ]
    expect(
      shouldRepairChemicalSwaps({
        recommendations: tipsOnly,
        hazardousInventory: [],
      }),
    ).toBe(false)
  })
})
