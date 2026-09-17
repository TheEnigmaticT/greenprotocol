import { describe, expect, it } from 'vitest'
import { buildEvidenceBackedCandidates } from '@/lib/recommendation-candidates'
import type { AnalysisStep, EnrichedChemical, LiteratureEvidenceMatch } from '@/lib/types'

const steps: AnalysisStep[] = [
  {
    stepNumber: 1,
    description: 'Extract the reaction mixture with dichloromethane.',
    chemicals: [
      { name: 'Dichloromethane', role: 'solvent', quantity: '20 mL', quantityMl: 20, quantityKg: null },
      { name: 'Triethylamine', role: 'base', quantity: '2 mmol', quantityMl: null, quantityKg: null },
    ],
    conditions: { temperature: '20 C', duration: '30 min', atmosphere: null },
  },
]

const enriched: EnrichedChemical[] = [
  {
    ...steps[0].chemicals[0],
    occurrenceId: '0:0',
    stepNumber: 1,
    smiles: 'ClCCl',
    reference_status: 'available',
    green_alternatives: [{ chemical: 'Ethyl acetate', source: 'CHEM21', content: 'CHEM21 lists this as a replacement option.' }],
    citations: [{ source_id: 'CHEM21', source_name: 'CHEM21', citation: 'Prat et al.' }],
  },
]

function evidence(overrides: Partial<LiteratureEvidenceMatch> = {}): LiteratureEvidenceMatch {
  return {
    id: 'evidence:1',
    sourceDocumentId: 'doi:example',
    title: 'Extraction alternatives',
    pageStart: 4,
    pageEnd: 4,
    quote: 'Ethyl acetate replaced dichloromethane during extraction.',
    evidenceType: 'comparison',
    applicability: 'Extraction solvent replacement',
    limitations: 'Optimize phase ratio.',
    candidateStatus: 'adjudicated_direct',
    similarity: 0.9,
    ...overrides,
  }
}

describe('buildEvidenceBackedCandidates', () => {
  it('builds an application-eligible solvent intervention only from direct evidence bound to the exact occurrence', () => {
    const [candidate] = buildEvidenceBackedCandidates({
      steps,
      enrichedChemicals: enriched,
      evidenceByCandidate: new Map([['0:0:ethyl acetate', [evidence()]]]),
    })

    expect(candidate).toMatchObject({
      kind: 'substitution',
      target: { stepNumber: 1, occurrenceId: '0:0', sourceChemical: 'Dichloromethane', role: 'solvent' },
      proposedAlternative: 'Ethyl acetate',
      evidenceAssessment: {
        state: 'direct-supported',
        eligibleForApplication: true,
        applicability: 'strong',
        directness: 'direct',
      },
    })
  })

  it('keeps a CHEM21 candidate visible but ineligible when no direct reaction evidence is available', () => {
    const [candidate] = buildEvidenceBackedCandidates({
      steps,
      enrichedChemicals: enriched,
      evidenceByCandidate: new Map([['0:0:ethyl acetate', []]]),
    })

    expect(candidate.evidenceAssessment).toMatchObject({
      state: 'no-direct-evidence',
      eligibleForApplication: false,
      directness: 'none',
    })
  })

  it('never creates a solvent substitution for a non-solvent occurrence', () => {
    const candidates = buildEvidenceBackedCandidates({
      steps,
      enrichedChemicals: [{
        ...enriched[0],
        occurrenceId: '0:1',
        name: 'Triethylamine',
        role: 'base',
        green_alternatives: [{ chemical: 'Ethyl acetate', source: 'CHEM21', content: 'Not a base replacement.' }],
      }],
      evidenceByCandidate: new Map([['0:1:ethyl acetate', [evidence()]]]),
    })

    expect(candidates).toEqual([])
  })

  it('does not permit candidate-only literature to become application-eligible', () => {
    const [candidate] = buildEvidenceBackedCandidates({
      steps,
      enrichedChemicals: enriched,
      evidenceByCandidate: new Map([['0:0:ethyl acetate', [evidence({ candidateStatus: 'candidate_pending_adjudication' })]]]),
    })

    expect(candidate.evidenceAssessment).toMatchObject({
      state: 'candidate-only',
      eligibleForApplication: false,
      directness: 'indirect',
    })
  })

  it('allows no-SMILES, text-anchored evidence candidates but marks applicability partial', () => {
    const [candidate] = buildEvidenceBackedCandidates({
      steps,
      enrichedChemicals: [{ ...enriched[0], smiles: undefined }],
      evidenceByCandidate: new Map([['0:0:ethyl acetate', [evidence()]]]),
    })

    expect(candidate.evidenceAssessment).toMatchObject({
      state: 'direct-supported',
      eligibleForApplication: true,
      applicability: 'partial',
    })
  })
})
