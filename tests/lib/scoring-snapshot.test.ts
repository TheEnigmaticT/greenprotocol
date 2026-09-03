import { describe, expect, it } from 'vitest'
import type { AnalysisResult, DeterministicScores } from '@/lib/types'
import {
  buildCanonicalScoringSnapshot,
  protocolFingerprint,
  shouldReuseCanonicalScoring,
} from '@/lib/scoring-snapshot'

const scores = {
  scores: [],
  total_score: 18,
  max_possible: 120,
  grade: 'A',
  smiles_extraction: {},
  yield_extraction: {},
} as unknown as DeterministicScores

function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    protocolTitle: 'Example',
    chemistrySubdomain: 'Organic synthesis',
    steps: [],
    recommendations: [],
    revisedProtocol: '',
    overallAssessment: {
      greenPrinciplesViolated: [],
      mostImpactfulChange: '',
      experimentalValidationNeeded: false,
      disclaimer: '',
    },
    deterministicScores: scores,
    chemistryDataStatus: {
      pending: false,
      deterministicScoringAvailable: true,
      unresolvedChemicals: [],
      indefiniteChemicals: [],
      message: 'All requested chemical reference data was available from cache or bundled sources.',
    },
    ...overrides,
  }
}

describe('canonical scoring snapshots', () => {
  it('gives equivalent whitespace-only protocol submissions the same fingerprint', async () => {
    await expect(protocolFingerprint('  Add 1 g reagent.\r\n\r\nHeat to 60 C.  '))
      .resolves.toBe(await protocolFingerprint('Add 1 g reagent.\n\nHeat to 60 C.'))
  })

  it('reuses only a complete deterministic score from the matching protocol', async () => {
    const protocol = 'Add 1 g reagent and heat to 60 C.'
    const snapshot = await buildCanonicalScoringSnapshot(protocol, analysis())

    await expect(shouldReuseCanonicalScoring(protocol, snapshot)).resolves.toBe(true)
    await expect(shouldReuseCanonicalScoring(`${protocol} Then cool.`, snapshot)).resolves.toBe(false)
    await expect(shouldReuseCanonicalScoring(protocol, await buildCanonicalScoringSnapshot(protocol, analysis({
      chemistryDataStatus: {
        pending: true,
        deterministicScoringAvailable: true,
        unresolvedChemicals: ['Unknown material'],
        indefiniteChemicals: [],
        message: 'Incomplete',
      },
    })))).resolves.toBe(false)
  })
})
