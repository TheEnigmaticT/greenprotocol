import { describe, expect, it } from 'vitest'
import { buildNoRecommendationsBullets } from '@/lib/no-recommendations-summary'

describe('buildNoRecommendationsBullets', () => {
  it('lists mixtures and materials we could not find data for in plain language', () => {
    const bullets = buildNoRecommendationsBullets({
      pending: false,
      deterministicScoringAvailable: true,
      unresolvedChemicals: ['brine'],
      indefiniteChemicals: ['aq. workup'],
      message: 'Partial',
    })

    expect(bullets).toEqual([
      'Mixtures or materials without a fixed composition, left out of scoring: aq. workup',
      "Materials we couldn't find reference data for, so they weren't fully scored: brine",
    ])
    expect(bullets.join(' ')).not.toMatch(/indefinite|unresolved|deterministic/i)
  })

  it('notes when the analysis could not be scored against reference data', () => {
    expect(buildNoRecommendationsBullets({
      pending: true,
      deterministicScoringAvailable: false,
      unresolvedChemicals: [],
      message: 'Down',
    })).toEqual([
      "We couldn't score this analysis against reference data this time.",
    ])
  })

  it('falls back when there are no structured blockers', () => {
    expect(buildNoRecommendationsBullets()).toEqual([
      'We had nothing evidenced enough to propose a change.',
    ])
  })
})
