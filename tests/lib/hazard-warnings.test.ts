import { describe, expect, it } from 'vitest'
import { buildHazardWarnings } from '@/lib/hazard-warnings'
import { canApplyAcceptedRecommendation } from '@/lib/finalized-protocol'
import type { EnrichedChemical, Recommendation } from '@/lib/types'

function enriched(partial: Partial<EnrichedChemical> & Pick<EnrichedChemical, 'name'>): EnrichedChemical {
  return {
    role: 'reagent',
    quantity: '',
    quantityMl: null,
    quantityKg: null,
    stepNumber: 1,
    ghs_hazards: [],
    green_alternatives: [],
    citations: [],
    data_source: 'pubchem',
    reference_status: 'available',
    ...partial,
  }
}

describe('hazard warnings', () => {
  it('warns when GHS is serious and no substitute is listed', () => {
    const [card] = buildHazardWarnings({
      recommendations: [],
      enrichedChemicals: [enriched({
        name: 'hydrochloric acid',
        ghs_hazards: [{ code: 'H314', description: 'Causes severe skin burns and eye damage', source: 'PubChem' }],
      })],
    })
    expect(card.cardKind).toBe('warning')
    expect(card.original.chemical).toBe('hydrochloric acid')
    expect(card.alternative.chemical).toBe('hydrochloric acid')
    expect(card.original.issue).toContain('No catalog lists a substitute')
    expect(card.evidenceAssessment?.eligibleForApplication).toBe(false)
    expect(canApplyAcceptedRecommendation({ ...card, isAccepted: true })).toBe(false)
  })

  it('stays quiet when a swap card already covers the chemical', () => {
    const swap = {
      cardKind: 'swap',
      original: { chemical: 'DMF', issue: 'bad' },
    } as Recommendation
    const cards = buildHazardWarnings({
      recommendations: [swap],
      enrichedChemicals: [enriched({
        name: 'DMF',
        ghs_hazards: [{ code: 'H360', description: 'May damage fertility', source: 'PubChem' }],
      })],
    })
    expect(cards).toEqual([])
  })

  it('keeps one warning when the same chemical appears in two steps', () => {
    const cards = buildHazardWarnings({
      recommendations: [],
      enrichedChemicals: [
        enriched({
          name: 'nitrous acid',
          stepNumber: 5,
          ghs_hazards: [{ code: 'H314', description: 'Causes severe skin burns and eye damage', source: 'PubChem' }],
        }),
        enriched({
          name: 'nitrous acid',
          stepNumber: 4,
          ghs_hazards: [{ code: 'H314', description: 'Causes severe skin burns and eye damage', source: 'PubChem' }],
        }),
      ],
    })
    expect(cards).toHaveLength(1)
    expect(cards[0].original.chemical).toBe('nitrous acid')
    expect(cards[0].stepNumber).toBe(5)
  })

  it('does not warn on water', () => {
    const cards = buildHazardWarnings({
      recommendations: [],
      enrichedChemicals: [enriched({ name: 'water', role: 'solvent' })],
    })
    expect(cards).toEqual([])
  })

  it('ignores aquatic "toxic" phrasing and drying salts', () => {
    const cards = buildHazardWarnings({
      recommendations: [],
      enrichedChemicals: [
        enriched({
          name: 'water',
          role: 'solvent',
          ghs_hazards: [{ code: 'H411', description: 'Toxic to aquatic life with long lasting effects', source: 'PubChem' }],
        }),
        enriched({
          name: 'magnesium sulfate',
          ghs_hazards: [{ code: 'H319', description: 'Causes serious eye irritation', source: 'PubChem' }],
        }),
        enriched({
          name: 'potassium carbonate',
          ghs_hazards: [{ code: 'H302', description: 'Harmful if swallowed', source: 'PubChem' }],
        }),
      ],
    })
    expect(cards).toEqual([])
  })
})
