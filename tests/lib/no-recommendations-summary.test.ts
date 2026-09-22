import { describe, expect, it } from 'vitest'
import { buildNoRecommendationsBullets } from '@/lib/no-recommendations-summary'

describe('buildNoRecommendationsBullets', () => {
  it('lists indefinite and unresolved materials', () => {
    expect(buildNoRecommendationsBullets({
      pending: false,
      deterministicScoringAvailable: true,
      unresolvedChemicals: ['brine'],
      indefiniteChemicals: ['aq. workup'],
      message: 'Partial',
    })).toEqual([
      'Indefinite materials: aq. workup',
      'Unscored / unresolved names: brine',
    ])
  })

  it('notes when deterministic scoring was unavailable', () => {
    expect(buildNoRecommendationsBullets({
      pending: true,
      deterministicScoringAvailable: false,
      unresolvedChemicals: [],
      message: 'Down',
    })).toEqual([
      'Deterministic scoring was unavailable for this run.',
    ])
  })

  it('falls back when there are no structured blockers', () => {
    expect(buildNoRecommendationsBullets()).toEqual([
      'We had nothing evidenced enough to propose a change.',
    ])
  })
})
