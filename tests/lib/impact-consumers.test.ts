import { describe, expect, it } from 'vitest'
import { calculateEquivalencies } from '@/lib/equivalencies'
import { aggregateClaimableImpact } from '@/lib/impact-inventory'
import type { ImpactDelta } from '@/lib/types'

const unavailableWithLegacyNumbers: ImpactDelta = {
  co2eSavedKg: 42,
  hazardousWasteEliminatedKg: 3,
  carcinogensEliminated: ['benzene'],
  waterSavedL: 100,
  energySavedKwh: 7,
  assessment: { level: 'unavailable', reasons: ['Replacement quantity is unknown.'] },
}

describe('impact consumers', () => {
  it('does not generate equivalencies from legacy numbers explicitly marked unavailable', () => {
    expect(calculateEquivalencies(unavailableWithLegacyNumbers)).toEqual([])
  })

  it('excludes explicitly unavailable legacy numbers from cumulative claimed savings while retaining legacy rows without an assessment', () => {
    const cumulative = aggregateClaimableImpact([
      unavailableWithLegacyNumbers,
      { co2eSavedKg: 2, hazardousWasteEliminatedKg: 1, carcinogensEliminated: ['chloroform'], waterSavedL: 5, energySavedKwh: 1 },
    ])

    expect(cumulative).toMatchObject({
      co2eSavedKg: 2,
      hazardousWasteEliminatedKg: 1,
      carcinogensEliminated: ['chloroform'],
      waterSavedL: 5,
      energySavedKwh: 1,
      unavailableAnalyses: 1,
      claimedAnalyses: 1,
    })
  })
})
