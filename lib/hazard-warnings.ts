import { lookupAcsGciprSolvent } from '@/lib/acs-gcipr'
import type { EnrichedChemical, Recommendation } from '@/lib/types'

/**
 * A hazardous material with no named substitute is a warning, not a swap.
 * The card never offers to change the procedure.
 */

/** Acute / chronic human hazards only. Bare "toxic" matches aquatic phrases and is too noisy. */
const SERIOUS = /\bH(300|301|310|311|314|318|330|331|340|350|351|360|361|370|372)\b|fatal|carcinogen|mutagen|reproduct|severe skin burn|serious eye damage|explosive/i

/** Everyday auxiliaries: never a warning card by themselves. */
const SKIP_WARNING = new Set([
  'water',
  'ice',
  'dry ice',
  'brine',
  'air',
  'nitrogen',
  'argon',
  'helium',
  'hydrogen',
  'oxygen',
  'sand',
  'celite',
  'silica',
  'silica gel',
  'sodium chloride',
  'magnesium sulfate',
  'sodium sulfate',
  'potassium carbonate',
  'sodium carbonate',
  'calcium chloride',
  'molecular sieves',
])

function seriousGhs(chem: EnrichedChemical): string | null {
  const hit = (chem.ghs_hazards ?? []).find(item => {
    const code = (item.code ?? '').trim()
    if (/\bH(300|301|310|311|314|318|330|331|340|350|351|360|361|370|372)\b/i.test(code)) {
      return true
    }
    return SERIOUS.test(item.description ?? '')
  })
  return hit?.description?.trim() || null
}

function shouldSkipWarning(name: string): boolean {
  return SKIP_WARNING.has(name.trim().toLowerCase())
}

function covered(name: string, recommendations: Recommendation[]): boolean {
  const key = name.trim().toLowerCase()
  return recommendations.some(rec =>
    rec.cardKind !== 'warning'
    && rec.original.chemical.trim().toLowerCase() === key,
  )
}

export function buildHazardWarnings(input: {
  enrichedChemicals?: EnrichedChemical[]
  recommendations: Recommendation[]
}): Recommendation[] {
  const additions: Recommendation[] = []
  const seen = new Set<string>()
  for (const chem of input.enrichedChemicals ?? []) {
    const name = chem.name?.trim()
    if (!name) continue
    if (shouldSkipWarning(name)) continue
    if ((chem.role ?? '').trim().toLowerCase() === 'product') continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    if (covered(name, input.recommendations)) continue
    if ((chem.green_alternatives?.length ?? 0) > 0) continue

    const acsMatch = lookupAcsGciprSolvent({ name, smiles: chem.smiles ?? undefined })
    const acs = acsMatch?.row
    const ranking = (acs?.adjustedRanking || acs?.defaultRanking || '').trim()
    const rankingBad = /hazard/i.test(ranking) && !/recommended|preferred|acceptable|usable/i.test(ranking)
    const ghs = seriousGhs(chem)
    if (!rankingBad && !ghs) continue
    if (!rankingBad && (chem.reference_status === 'unavailable' || chem.reference_status === 'indefinite')) continue

    seen.add(key)
    const bits = [`${name} is hazardous.`]
    if (rankingBad) bits.push(`The solvent catalog ranks it ${ranking}.`)
    else if (ghs) bits.push(ghs.endsWith('.') ? ghs : `${ghs}.`)
    bits.push('No catalog lists a substitute. This does not change the procedure.')
    const sentence = bits.join(' ')
    const high = SERIOUS.test(`${ghs ?? ''} ${ranking}`) || /highly/i.test(ranking)
    additions.push({
      stepNumber: chem.stepNumber ?? 1,
      principleNumbers: [3],
      principleNames: ['Less Hazardous Chemical Syntheses'],
      severity: high ? 'high' : 'medium',
      cardKind: 'warning',
      original: { chemical: name, issue: sentence },
      alternative: {
        chemical: name,
        rationale: sentence,
        yieldImpact: 'None. The procedure is not changed.',
        caveats: 'There is no replacement to accept.',
        evidenceBasis: rankingBad
          ? 'ACS GCIPR solvent catalog. Not a substitution.'
          : 'PubChem GHS. Not a substitution.',
      },
      confidenceLevel: 'high',
      evidenceTier: 'sourced',
      evidenceAssessment: {
        disposition: 'insufficient_evidence',
        directness: 'none',
        supportingReferenceCount: 0,
        applicability: 'none',
        eligibleForApplication: false,
        eligibilityReason: 'A hazard warning is not a substitution and does not revise the procedure.',
      },
    })
  }
  return additions
}
