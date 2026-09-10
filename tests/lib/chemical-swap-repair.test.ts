import { describe, expect, it } from 'vitest'
import { isInventoryGroundedChemicalSwap } from '@/lib/chemical-swap-repair'
import type { HazardousInventoryItem } from '@/lib/hazardous-inventory'
import type { Recommendation } from '@/lib/types'

function swap(original: string, alternative: string, confidenceLevel: Recommendation['confidenceLevel'] = 'low'): Recommendation {
  return {
    stepNumber: 2,
    principleNumbers: [3],
    principleNames: ['Less Hazardous Chemical Syntheses'],
    severity: 'high',
    kind: 'chemical_swap',
    original: { chemical: original, issue: 'hazardous inventory chemical' },
    alternative: { chemical: alternative, rationale: 'less hazardous replacement', yieldImpact: 'requires validation', caveats: '', evidenceBasis: 'published precedent' },
    confidenceLevel,
  }
}

const inventory: HazardousInventoryItem[] = [{
  name: 'concentrated phosphoric acid',
  classes: ['corrosive_mineral_acid'],
  signals: ['name:mineral_acid'],
  role: 'catalyst',
  stepNumber: 2,
}]

describe('isInventoryGroundedChemicalSwap', () => {
  it('accepts a non-solvent catalyst swap grounded in the hazardous inventory without changing low confidence', () => {
    const rec = swap('phosphoric acid', 'methanesulfonic acid', 'low')
    expect(isInventoryGroundedChemicalSwap(rec, inventory)).toBe(true)
    expect(rec.confidenceLevel).toBe('low')
  })

  it('rejects a repair swap whose original chemical is not in the hazardous inventory', () => {
    expect(isInventoryGroundedChemicalSwap(swap('TLC', 'ethyl acetate'), inventory)).toBe(false)
  })

  it('rejects a concentration-qualified identity swap', () => {
    expect(isInventoryGroundedChemicalSwap(swap('phosphoric acid', 'concentrated phosphoric acid'), inventory)).toBe(false)
  })
})
