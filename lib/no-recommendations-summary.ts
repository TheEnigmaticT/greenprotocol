import type { ChemistryDataStatus } from '@/lib/types'

/** Structured empty-state bullets from chemistryDataStatus. */
export function buildNoRecommendationsBullets(status?: ChemistryDataStatus): string[] {
  const bullets: string[] = []
  const indefinite = status?.indefiniteChemicals ?? []
  const unresolved = status?.unresolvedChemicals ?? []

  if (indefinite.length > 0) {
    bullets.push(`Indefinite materials: ${indefinite.join(', ')}`)
  }
  if (unresolved.length > 0) {
    bullets.push(`Unscored / unresolved names: ${unresolved.join(', ')}`)
  }
  if (status && status.deterministicScoringAvailable === false) {
    bullets.push('Deterministic scoring was unavailable for this run.')
  }
  if (bullets.length === 0) {
    bullets.push('We had nothing evidenced enough to propose a change.')
  }
  return bullets
}
