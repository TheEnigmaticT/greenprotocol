import { describe, expect, it } from 'vitest'
import {
  buildEvidenceBackedCandidates,
  buildHypothesisRecommendation,
  isEligibleToReviseProcedure,
  screenSolventCompatibility,
} from '@/lib/recommendation-candidates'
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
    limitations: undefined,
    candidateStatus: 'adjudicated_direct',
    similarity: 0.9,
    ...overrides,
  }
}

describe('buildEvidenceBackedCandidates', () => {
  it('emits supported_applicable for direct solvent-context evidence with SMILES and no hard conflicts', () => {
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
        disposition: 'supported_applicable',
        eligibleForApplication: true,
        applicability: 'strong',
        directness: 'direct',
      },
    })
    expect(isEligibleToReviseProcedure(candidate.evidenceAssessment)).toBe(true)
  })

  it('keeps CHEM21-only candidates as insufficient_evidence and not application-eligible', () => {
    const [candidate] = buildEvidenceBackedCandidates({
      steps,
      enrichedChemicals: enriched,
      evidenceByCandidate: new Map([['0:0:ethyl acetate', []]]),
    })

    expect(candidate.evidenceAssessment).toMatchObject({
      disposition: 'insufficient_evidence',
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

  it('maps candidate-only literature to analogous_only', () => {
    const [candidate] = buildEvidenceBackedCandidates({
      steps,
      enrichedChemicals: enriched,
      evidenceByCandidate: new Map([['0:0:ethyl acetate', [evidence({ candidateStatus: 'candidate_pending_adjudication' })]]]),
    })
    expect(candidate.evidenceAssessment).toMatchObject({
      disposition: 'analogous_only',
      eligibleForApplication: false,
      directness: 'indirect',
    })
    const hypothesis = buildHypothesisRecommendation(candidate)
    expect(hypothesis?.evidenceAssessment?.disposition).toBe('analogous_only')
    expect(hypothesis?.confidenceLevel).toBe('low')
  })

  it('marks no-SMILES direct evidence as supported_with_constraints', () => {
    const [candidate] = buildEvidenceBackedCandidates({
      steps,
      enrichedChemicals: [{ ...enriched[0], smiles: undefined }],
      evidenceByCandidate: new Map([['0:0:ethyl acetate', [evidence()]]]),
    })
    expect(candidate.evidenceAssessment).toMatchObject({
      disposition: 'supported_with_constraints',
      eligibleForApplication: false,
    })
  })

  it('suppresses contradicted_or_inapplicable from hypothesis phrasing', () => {
    const [candidate] = buildEvidenceBackedCandidates({
      steps,
      enrichedChemicals: enriched,
      evidenceByCandidate: new Map([['0:0:ethyl acetate', [evidence({
        candidateStatus: 'contradicted',
        applicability: 'Incompatible with this procedure',
        quote: 'Ethyl acetate is incompatible with this catalyst system.',
      })]]]),
    })
    expect(candidate.evidenceAssessment.disposition).toBe('contradicted_or_inapplicable')
    expect(buildHypothesisRecommendation(candidate)).toBeNull()
  })

  it('fail-closes deferred retrieval to insufficient_evidence', () => {
    const [candidate] = buildEvidenceBackedCandidates({
      steps,
      enrichedChemicals: enriched,
      evidenceByCandidate: new Map(),
      deferredCandidateKeys: new Set(['0:0:ethyl acetate']),
    })
    expect(candidate.evidenceAssessment).toMatchObject({
      disposition: 'insufficient_evidence',
      eligibleForApplication: false,
    })
  })
})

describe('screenSolventCompatibility', () => {
  it('flags inert-atmosphere constraints when the step omits atmosphere', () => {
    const result = screenSolventCompatibility(steps[0], [evidence({
      limitations: 'Requires inert atmosphere (nitrogen or argon).',
    })])
    expect(result.contradicted).toBe(false)
    expect(result.constraints.some(c => /inert atmosphere/i.test(c))).toBe(true)
  })
})

describe('assembly eligibility gate', () => {
  it('only supported_applicable may revise the assembled procedure automatically', () => {
    const applicable = buildEvidenceBackedCandidates({
      steps,
      enrichedChemicals: enriched,
      evidenceByCandidate: new Map([['0:0:ethyl acetate', [evidence()]]]),
    })[0]
    const chem21Only = buildEvidenceBackedCandidates({
      steps,
      enrichedChemicals: enriched,
      evidenceByCandidate: new Map([['0:0:ethyl acetate', []]]),
    })[0]
    expect(isEligibleToReviseProcedure(applicable.evidenceAssessment)).toBe(true)
    expect(isEligibleToReviseProcedure(chem21Only.evidenceAssessment)).toBe(false)
  })
})
