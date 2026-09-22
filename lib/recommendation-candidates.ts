import type {
  AnalysisStep,
  EnrichedChemical,
  EvidenceBackedCandidate,
  LiteratureEvidenceMatch,
  Recommendation,
  RecommendationDisposition,
  RecommendationEvidenceAssessment,
} from '@/lib/types'
import { lookupAcsGciprSolvent } from '@/lib/acs-gcipr'

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

/**
 * Parser role labels wobble between solvent, workup, and other.
 * A catalog hit on name or SMILES covers those. A base, reagent, or
 * catalyst stays what the parser said, even if the catalog also lists that name.
 */
function countsAsSolventSuggestion(
  role: string | undefined,
  name: string | undefined,
  smiles: string | undefined,
): boolean {
  if (isSolvent(role)) return true
  const label = normalized(role ?? '')
  if (label !== 'workup' && label !== 'other' && label !== '') return false
  if (!name?.trim() && !smiles?.trim()) return false
  return lookupAcsGciprSolvent({ name, smiles }) !== null
}

/**
 * Direct reaction/procedure evidence — not CHEM21 catalogue guidance.
 * Prefer explicit adjudication statuses over open-ended keyword matches.
 */
function isDirectEvidence(match: LiteratureEvidenceMatch): boolean {
  const status = normalized(match.candidateStatus)
  return (
    status === 'adjudicated_direct'
    || status === 'adjudicated'
    || status === 'approved'
    || status === 'direct'
    || status.startsWith('adjudicated_direct')
    || status.startsWith('approved_')
  )
}

function isContradictedEvidence(match: LiteratureEvidenceMatch): boolean {
  const status = normalized(match.candidateStatus)
  if (
    status.includes('contradict')
    || status.includes('reject')
    || status.includes('inapplicable')
    || status.includes('incompatible')
    || status === 'contradicted'
    || status === 'rejected'
  ) {
    return true
  }

  const blob = `${match.applicability ?? ''} ${match.limitations ?? ''} ${match.quote ?? ''}`.toLowerCase()
  return /\b(contra\s*indicat|incompatible with|not suitable as a (?:drop-?in )?replacement|failed to replace|does not replace)\b/.test(blob)
}

function supportsSolventContext(match: LiteratureEvidenceMatch): boolean {
  const context = `${match.applicability ?? ''} ${match.evidenceType ?? ''} ${match.quote ?? ''}`.toLowerCase()
  // Require an explicit solvent-role cue — catalogue hazard text alone is insufficient.
  return /\b(solvent|extraction|work-?up|wash(?:es|ing)?|reaction medium|reaction solvent)\b/.test(context)
}

export interface CompatibilityScreenResult {
  contradicted: boolean
  constraints: string[]
  limitingFactors: string[]
}

/**
 * Hard compatibility screen against the parsed step/procedure.
 * CHEM21 membership is not application eligibility.
 */
export function screenSolventCompatibility(
  step: AnalysisStep,
  matches: LiteratureEvidenceMatch[],
): CompatibilityScreenResult {
  const constraints: string[] = []
  const limitingFactors: string[] = []
  let contradicted = matches.some(isContradictedEvidence)

  const temperature = step.conditions.temperature?.toLowerCase() ?? ''
  const atmosphere = step.conditions.atmosphere?.toLowerCase() ?? ''

  for (const match of matches) {
    const limitations = (match.limitations ?? '').toLowerCase()
    const applicability = (match.applicability ?? '').toLowerCase()
    const blob = `${limitations} ${applicability}`

    if (blob.trim()) {
      limitingFactors.push(match.limitations?.trim() || match.applicability?.trim() || match.quote.slice(0, 160))
    }

    if (/\b(cryogenic|below\s*-?\d+\s*°?\s*c|low temperature)\b/.test(blob) && /reflux|heat|\b[1-9]\d{2}\s*°?\s*c\b/.test(temperature)) {
      constraints.push('Literature constraints imply low-temperature use; protocol temperature may be incompatible.')
    }

    // Fail closed: missing atmosphere declaration does not satisfy an inert-atmosphere requirement.
    if (/\binert(?: atmosphere)?|nitrogen|argon|schlenk\b/.test(blob) && !/n2|nitrogen|argon|inert/.test(atmosphere)) {
      constraints.push('Literature use requires an inert atmosphere not declared for this step.')
    }

    if (/\banhydrous|water[- ]free|moisture[- ]sensitive\b/.test(blob) && /aqueous|water\b/.test(step.description.toLowerCase())) {
      constraints.push('Literature use assumes anhydrous conditions; step text mentions water/aqueous handling.')
    }

    if (/\bnot (?:a )?drop-?in\b|\brequires reoptimisation\b|\breoptimization\b|\bcatalyst (?:poison|incompat)/.test(blob)) {
      constraints.push('Literature reports non-drop-in behavior or required reoptimization.')
    }

    if (/\bincompatible with (?:this|the) (?:substrate|catalyst|procedure)\b/.test(blob)) {
      contradicted = true
    }
  }

  return {
    contradicted,
    constraints: [...new Set(constraints)],
    limitingFactors: [...new Set(limitingFactors.filter(Boolean))],
  }
}

export function isVisibleDisposition(disposition: RecommendationDisposition): boolean {
  return disposition !== 'contradicted_or_inapplicable'
}

export function isPhraseableDisposition(disposition: RecommendationDisposition): boolean {
  return disposition === 'supported_applicable' || disposition === 'supported_with_constraints'
}

function assessmentFor(
  matches: LiteratureEvidenceMatch[],
  step: AnalysisStep,
  hasSmiles: boolean,
  deferred: boolean,
): RecommendationEvidenceAssessment {
  if (deferred) {
    return {
      disposition: 'insufficient_evidence',
      directness: 'none',
      supportingReferenceCount: 0,
      applicability: 'none',
      eligibleForApplication: false,
      eligibilityReason:
        'Evidence retrieval failed or was deferred; hypothesis may remain visible but no change can be applied.',
    }
  }

  const screen = screenSolventCompatibility(step, matches)
  if (screen.contradicted) {
    return {
      disposition: 'contradicted_or_inapplicable',
      directness: matches.some(isDirectEvidence) ? 'direct' : matches.length > 0 ? 'indirect' : 'none',
      supportingReferenceCount: matches.length,
      applicability: 'none',
      eligibleForApplication: false,
      eligibilityReason: 'Retrieved evidence contradicts or marks this solvent change inapplicable for the procedure context.',
      constraints: screen.constraints,
      limitingFactors: screen.limitingFactors,
    }
  }

  const direct = matches.filter(match => isDirectEvidence(match) && supportsSolventContext(match))
  if (direct.length > 0) {
    // Hard procedure conflicts or missing structural anchor => constrained (visible, not auto-applicable).
    // Mild literature caveats remain limitingFactors on supported_applicable without blocking eligibility.
    const needsConstraints = screen.constraints.length > 0 || !hasSmiles
    if (needsConstraints) {
      return {
        disposition: 'supported_with_constraints',
        directness: 'direct',
        supportingReferenceCount: direct.length,
        applicability: hasSmiles ? 'partial' : 'weak',
        eligibleForApplication: false,
        eligibilityReason: hasSmiles
          ? 'Direct solvent-context evidence exists, but procedure constraints require laboratory validation before application.'
          : 'Direct solvent-context evidence exists without a structural (SMILES) anchor; treat as constrained and validate before application.',
        constraints: screen.constraints.length > 0
          ? screen.constraints
          : ['Validate yield, selectivity, and work-up under the parsed procedure conditions.'],
        limitingFactors: screen.limitingFactors,
      }
    }

    return {
      disposition: 'supported_applicable',
      directness: 'direct',
      supportingReferenceCount: direct.length,
      applicability: 'strong',
      eligibleForApplication: true,
      eligibilityReason:
        'Direct, adjudicated solvent-context evidence is bound to this occurrence with a structural anchor and no hard compatibility contradictions.',
      limitingFactors: screen.limitingFactors,
    }
  }

  if (matches.length > 0) {
    return {
      disposition: 'analogous_only',
      directness: 'indirect',
      supportingReferenceCount: matches.length,
      applicability: 'weak',
      eligibleForApplication: false,
      eligibilityReason:
        'Only analogous or non-adjudicated literature was retrieved; CHEM21/hazard guidance remains separate and does not establish reaction performance.',
      constraints: screen.constraints,
      limitingFactors: screen.limitingFactors,
    }
  }

  return {
    disposition: 'insufficient_evidence',
    directness: 'none',
    supportingReferenceCount: 0,
    applicability: 'none',
    eligibleForApplication: false,
    eligibilityReason:
      'No reaction/procedure literature evidence was retrieved. CHEM21 alternatives are hazard-guidance candidates only and are not application-eligible.',
  }
}

/**
 * Create role- and occurrence-bounded intervention candidates before any model
 * is permitted to phrase a recommendation. Shipping slice: solvents only.
 */
export function buildEvidenceBackedCandidates(
  input: BuildEvidenceBackedCandidatesInput,
): EvidenceBackedCandidate[] {
  const stepByNumber = new Map(input.steps.map(step => [step.stepNumber, step]))
  const candidates: EvidenceBackedCandidate[] = []

  for (const chemical of input.enrichedChemicals) {
    if (!chemical.occurrenceId || !chemical.stepNumber || !countsAsSolventSuggestion(chemical.role, chemical.name, chemical.smiles)) continue
    const step = stepByNumber.get(chemical.stepNumber)
    if (!step) continue

    for (const alternative of chemical.green_alternatives ?? []) {
      if (!alternative.chemical.trim() || normalized(alternative.chemical) === normalized(chemical.name)) continue
      const key = keyFor(chemical.occurrenceId, alternative.chemical)
      const evidence = input.evidenceByCandidate.get(key) ?? []
      const evidenceAssessment = assessmentFor(
        evidence,
        step,
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

/** Recommendations that may revise the assembled/finalized procedure. */
export function isEligibleToReviseProcedure(assessment: RecommendationEvidenceAssessment | undefined): boolean {
  if (!assessment) return false
  return assessment.eligibleForApplication && assessment.disposition === 'supported_applicable'
}


/** Deterministic hypothesis cards for non-phraseable visible dispositions. */
export function buildHypothesisRecommendation(candidate: EvidenceBackedCandidate): Recommendation | null {
  const assessment = candidate.evidenceAssessment
  if (!isVisibleDisposition(assessment.disposition)) return null
  if (isPhraseableDisposition(assessment.disposition)) return null

  const source = candidate.target.sourceChemical ?? 'unknown solvent'
  const alternative = candidate.proposedAlternative ?? 'unknown alternative'
  const hypothesisNote = 'Suggestion only. The procedure is not changed.'

  return {
    stepNumber: candidate.target.stepNumber,
    principleNumbers: [5],
    principleNames: ['Safer Solvents and Auxiliaries'],
    severity: 'low',
    original: {
      chemical: source,
      issue: `Possible replacement for ${source}.`,
    },
    alternative: {
      chemical: alternative,
      rationale: `Consider replacing ${source} with ${alternative}. A solvent catalogue lists ${alternative} as an alternative. This is a suggestion, not proof it works in this step.`,
      yieldImpact: 'Unknown. Not established for this exact procedure.',
      caveats: [hypothesisNote, ...(assessment.constraints ?? [])].filter(Boolean).join(' '),
      evidenceBasis: candidate.anchor === 'chem21'
        ? 'CHEM21 solvent catalogue. Deterministic scores stay separate.'
        : 'Solvent catalogue and any non-applicable literature. Deterministic scores stay separate.',
    },
    evidenceAssessment: assessment,
    evidenceCandidateId: candidate.id,
    confidenceLevel: 'low',
  }
}
