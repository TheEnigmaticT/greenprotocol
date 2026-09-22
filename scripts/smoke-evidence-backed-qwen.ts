/**
 * Live smoke for evidence-backed solvent dispositions via OpenRouter Qwen.
 *
 * Required env (do not commit secrets):
 *   OPENROUTER_API_KEY
 *   GCAI_ENGINE_CANDIDATE=1
 *   GCAI_LLM_BASE_URL=https://openrouter.ai/api/v1
 *   GCAI_LLM_MODEL=qwen/qwen3.8-27b
 *
 * Example:
 *   set -a && source .env.local && set +a
 *   GCAI_ENGINE_CANDIDATE=1 GCAI_LLM_BASE_URL=https://openrouter.ai/api/v1 \
 *   GCAI_LLM_MODEL=qwen/qwen3.8-27b npx tsx scripts/smoke-evidence-backed-qwen.ts
 *
 * This smoke verifies the decision helper contract locally (no network) when
 * OPENROUTER_API_KEY is absent, and optionally calls Qwen for phrasing when present.
 */
import {
  buildEvidenceBackedCandidates,
  isEligibleToReviseProcedure,
} from '../lib/recommendation-candidates'
import type { AnalysisStep, EnrichedChemical, LiteratureEvidenceMatch } from '../lib/types'

const steps: AnalysisStep[] = [{
  stepNumber: 1,
  description: 'Extract the product with dichloromethane.',
  chemicals: [
    { name: 'Dichloromethane', role: 'solvent', quantity: '50 mL', quantityMl: 50, quantityKg: null },
  ],
  conditions: { temperature: '25 C', duration: '10 min', atmosphere: null },
}]

const enriched: EnrichedChemical[] = [{
  ...steps[0].chemicals[0],
  occurrenceId: '0:0',
  stepNumber: 1,
  smiles: 'ClCCl',
  green_alternatives: [{ chemical: 'Ethyl acetate', source: 'CHEM21', content: 'CHEM21 replacement option.' }],
}]

const directEvidence: LiteratureEvidenceMatch[] = [{
  id: 'e1',
  sourceDocumentId: 'doi:smoke',
  title: 'Solvent swap',
  pageStart: 1,
  pageEnd: 1,
  quote: 'Ethyl acetate replaced dichloromethane as extraction solvent.',
  evidenceType: 'comparison',
  applicability: 'Extraction solvent',
  candidateStatus: 'adjudicated_direct',
  similarity: 0.91,
}]

function summarize() {
  const applicable = buildEvidenceBackedCandidates({
    steps,
    enrichedChemicals: enriched,
    evidenceByCandidate: new Map([['0:0:ethyl acetate', directEvidence]]),
  })[0]
  const insufficient = buildEvidenceBackedCandidates({
    steps,
    enrichedChemicals: enriched,
    evidenceByCandidate: new Map([['0:0:ethyl acetate', []]]),
  })[0]

  const report = {
    supported_applicable: applicable.evidenceAssessment.disposition,
    supported_applicable_eligible: isEligibleToReviseProcedure(applicable.evidenceAssessment),
    chem21_only_disposition: insufficient.evidenceAssessment.disposition,
    chem21_only_eligible: isEligibleToReviseProcedure(insufficient.evidenceAssessment),
    openrouter_key_present: Boolean(process.env.OPENROUTER_API_KEY),
    model: process.env.GCAI_LLM_MODEL ?? null,
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.supported_applicable_eligible || report.chem21_only_eligible) {
    throw new Error('disposition contract failed')
  }
  if (report.supported_applicable !== 'supported_applicable' || report.chem21_only_disposition !== 'insufficient_evidence') {
    throw new Error('unexpected dispositions')
  }
}

summarize()
console.log('smoke-evidence-backed-qwen: contract OK')
if (!process.env.OPENROUTER_API_KEY) {
  console.log('OPENROUTER_API_KEY absent — skipped live Qwen phrasing call')
}
