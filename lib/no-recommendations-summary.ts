import type { ChemistryDataStatus } from '@/lib/types'

/** Structured empty-state bullets from chemistryDataStatus. */
export function buildNoRecommendationsBullets(status?: ChemistryDataStatus): string[] {
  const bullets: string[] = []
  const indefinite = status?.indefiniteChemicals ?? []
  const unresolved = status?.unresolvedChemicals ?? []

  if (indefinite.length > 0) {
    bullets.push(`Mixtures or materials without a fixed composition, left out of scoring: ${indefinite.join(', ')}`)
  }
  if (unresolved.length > 0) {
    bullets.push(`Materials we couldn't find reference data for, so they weren't fully scored: ${unresolved.join(', ')}`)
  }
  if (status && status.deterministicScoringAvailable === false) {
    bullets.push("We couldn't score this analysis against reference data this time.")
  }
  if (bullets.length === 0) {
    bullets.push('We had nothing evidenced enough to propose a change.')
  }
  return bullets
}
