import type {
  AnalysisStep,
  EnrichedChemical,
  EvidenceBackedCandidate,
  LiteratureEvidenceMatch,
  RecommendationEvidenceAssessment,
} from '@/lib/types'

export interface BuildEvidenceBackedCandidatesInput {
  steps: AnalysisStep[]
  enrichedChemicals: EnrichedChemical[]
  /** Keyed as `${occurrenceId}:${normalized alternative}`. */
  evidenceByCandidate: ReadonlyMap<string, LiteratureEvidenceMatch[]>
  deferredCandidateKeys?: ReadonlySet<string>
}

const normalized = (value: string) => value.trim().toLowerCase()
const keyFor = (occurrenceId: string, alternative: string) => `${occurrenceId}:${normalized(alternative)}`

function isSolvent(role: string | undefined): boolean {
  return normalized(role ?? '') === 'solvent'
}

function isDirectEvidence(match: LiteratureEvidenceMatch): boolean {
  return /^(adjudicated|approved|direct)/.test(normalized(match.candidateStatus))
}

function supportsSolventContext(match: LiteratureEvidenceMatch): boolean {
  const context = `${match.applicability ?? ''} ${match.evidenceType ?? ''}`.toLowerCase()
  return /solvent|extraction|workup|wash|reaction medium/.test(context)
}

function assessmentFor(
  matches: LiteratureEvidenceMatch[],
  hasSmiles: boolean,
  deferred: boolean,
): RecommendationEvidenceAssessment {
  if (deferred) {
    return {
      state: 'deferred', directness: 'none', supportingReferenceCount: 0,
      applicability: 'none', eligibleForApplication: false,
      eligibilityReason: 'Evidence retrieval is deferred or unavailable; no change can be applied.',
    }
  }

  const direct = matches.filter(match => isDirectEvidence(match) && supportsSolventContext(match))
  if (direct.length > 0) {
    return {
      state: 'direct-supported', directness: 'direct', supportingReferenceCount: direct.length,
      applicability: hasSmiles ? 'strong' : 'partial', eligibleForApplication: true,
      eligibilityReason: hasSmiles
        ? 'Direct, adjudicated evidence is bound to a solvent occurrence with a verified structural anchor.'
        : 'Direct, adjudicated evidence is bound to a solvent occurrence; reaction structure was unavailable.',
    }
  }

  if (matches.length > 0) {
    return {
      state: 'candidate-only', directness: 'indirect', supportingReferenceCount: matches.length,
      applicability: 'weak', eligibleForApplication: false,
      eligibilityReason: 'Retrieved evidence is preliminary or lacks a compatible solvent-context adjudication.',
    }
  }

  return {
    state: 'no-direct-evidence', directness: 'none', supportingReferenceCount: 0,
    applicability: 'none', eligibleForApplication: false,
    eligibilityReason: 'No direct, adjudicated reaction or procedure evidence was retrieved for this change.',
  }
}

/**
 * Create role- and occurrence-bounded intervention candidates before any model
 * is permitted to phrase a recommendation. The initial shipping slice is
 * intentionally limited to explicit solvent-guide alternatives.
 */
export function buildEvidenceBackedCandidates(
  input: BuildEvidenceBackedCandidatesInput,
): EvidenceBackedCandidate[] {
  const stepByNumber = new Map(input.steps.map(step => [step.stepNumber, step]))
  const candidates: EvidenceBackedCandidate[] = []

  for (const chemical of input.enrichedChemicals) {
    if (!chemical.occurrenceId || !chemical.stepNumber || !isSolvent(chemical.role)) continue
    const step = stepByNumber.get(chemical.stepNumber)
    if (!step) continue

    for (const alternative of chemical.green_alternatives ?? []) {
      if (!alternative.chemical.trim() || normalized(alternative.chemical) === normalized(chemical.name)) continue
      const key = keyFor(chemical.occurrenceId, alternative.chemical)
      const evidence = input.evidenceByCandidate.get(key) ?? []
      const evidenceAssessment = assessmentFor(
        evidence,
        Boolean(chemical.smiles),
        input.deferredCandidateKeys?.has(key) ?? false,
      )

      candidates.push({
        id: `candidate:${key}`,
        kind: 'substitution',
        target: {
          stepNumber: step.stepNumber,
          occurrenceId: chemical.occurrenceId,
          sourceChemical: chemical.name,
          role: chemical.role,
        },
        proposedAlternative: alternative.chemical,
        anchor: normalized(alternative.source).includes('chem21') ? 'chem21' : 'literature',
        evidence,
        evidenceAssessment,
      })
    }
  }

  return candidates
}

export function evidenceCandidateKey(occurrenceId: string, alternative: string): string {
  return keyFor(occurrenceId, alternative)
}
