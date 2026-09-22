import { randomUUID } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { boundLiteratureQuery } from './literature-query'
import { QWEN_MODEL, callQwen } from '@/lib/qwen-adapter'
import { AnalysisResult, AnalysisStep, Recommendation, ProgressEvent, DeterministicScores, EnrichedChemical, WasteAnalysis, type LiteratureEvidenceMatch, type EvidenceBackedCandidate } from '@/lib/types'
import { buildEvidenceBackedCandidates, buildHypothesisRecommendation, evidenceCandidateKey, isPhraseableDisposition, isEligibleToReviseProcedure } from '@/lib/recommendation-candidates'
import { applyAcsGciprRecommendations } from '@/lib/acs-gcipr'
import { buildHazardWarnings } from '@/lib/hazard-warnings'
import { normalizeParsedMaterials } from '@/lib/material-names'
import { batchConvert, scoreProtocol, isServiceAvailable } from '@/lib/chemistry-service'
import { prepareChemicalInputs } from '@/lib/chemical-inputs'
import { groundDeclaredProducts } from '@/lib/declared-products'
import { getAnalysisMetadata } from '@/lib/version'
import { CANDIDATE_PARSE_SYSTEM_PROMPT, PARSE_SYSTEM_PROMPT } from '@/lib/prompts/parse'
import { PRINCIPLES, buildPrinciplePrompt, type PrincipleDefinition } from '@/lib/prompts/principles'
import { buildAssemblePrompt } from '@/lib/prompts/assemble'
import { citationFromEvidenceMatch, searchLiteratureEvidence } from '@/lib/literature-evidence'
import { buildSdsReferences } from '@/lib/sds'
import { logLLMTrace, logDedupTrace } from '@/lib/trace'
import type { SupabaseClient } from '@supabase/supabase-js'

const SONNET = 'claude-sonnet-4-5-20250929'

let anthropic: Anthropic | undefined

export class NotChemistryError extends Error {
  message: string
  constructor(msg: string) {
    super(msg)
    this.name = 'NotChemistryError'
    this.message = msg
  }
}

// ─── Shared Utilities ───────────────────────────────────────────

// Tool use schemas for each pipeline phase — forces the API to return valid JSON
type InputSchema = Anthropic.Messages.Tool['input_schema']

const PARSE_SCHEMA: InputSchema = {
  type: 'object',
  properties: {
    protocolTitle: { type: 'string' },
    chemistrySubdomain: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stepNumber: { type: 'number' },
          description: { type: 'string' },
          chemicals: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                role: { type: 'string' },
                quantity: { type: 'string' },
                quantityMl: { type: 'number' },
                quantityKg: { type: 'number' },
              },
              required: ['name', 'role'],
            },
          },
          conditions: {
            type: 'object',
            properties: {
              temperature: { type: 'string' },
              duration: { type: 'string' },
              atmosphere: { type: 'string' },
            },
          },
        },
        required: ['stepNumber', 'description', 'chemicals', 'conditions'],
      },
    },
    error: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['protocolTitle', 'chemistrySubdomain', 'steps'],
}

const PRINCIPLE_SCHEMA: InputSchema = {
  type: 'object',
  properties: {
    principleNumber: { type: 'number' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stepNumber: { type: 'number' },
          principleNumbers: { type: 'array', items: { type: 'number' } },
          principleNames: { type: 'array', items: { type: 'string' } },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          original: {
            type: 'object',
            properties: {
              chemical: { type: 'string' },
              issue: { type: 'string' },
            },
            required: ['chemical', 'issue'],
          },
          alternative: {
            type: 'object',
            properties: {
              chemical: { type: 'string' },
              rationale: { type: 'string' },
              yieldImpact: { type: 'string' },
              caveats: { type: 'string' },
              evidenceBasis: { type: 'string' },
            },
            required: ['chemical', 'rationale'],
          },
          confidenceLevel: { type: 'string', enum: ['high', 'medium', 'low'] },
          primaryBenefit: { type: 'string' },
        },
        required: ['stepNumber', 'original', 'alternative'],
      },
    },
  },
  required: ['principleNumber', 'recommendations'],
}

const ASSEMBLE_SCHEMA: InputSchema = {
  type: 'object',
  properties: {
    revisedProtocol: { type: 'string' },
    overallAssessment: {
      type: 'object',
      properties: {
        greenPrinciplesViolated: { type: 'array', items: { type: 'number' } },
        mostImpactfulChange: { type: 'string' },
        experimentalValidationNeeded: { type: 'boolean' },
        disclaimer: { type: 'string' },
      },
      required: ['greenPrinciplesViolated', 'mostImpactfulChange', 'experimentalValidationNeeded', 'disclaimer'],
    },
  },
  required: ['revisedProtocol', 'overallAssessment'],
}

interface CallContext {
  userId?: string
  analysisId?: string
  analysisRunId?: string
  supabase?: SupabaseClient
}

interface TransportMessage {
  content: Array<{ type: string; input?: unknown }>
  usage: { input_tokens: number; output_tokens: number }
  stop_reason: string | null
}

function isQwenTransportEnabled(): boolean {
  return process.env.GCAI_ENGINE_CANDIDATE === '1' || process.env.GCAI_QWEN_PARITY === '1'
}

async function callClaude<T>(
  system: string,
  userContent: string,
  schema: InputSchema,
  label: string = 'unknown',
  model: string = SONNET,
  context?: CallContext
): Promise<T> {
  const startTime = new Date()
  const start = Date.now()
  const selectedModel = isQwenTransportEnabled() ? process.env.GCAI_LLM_MODEL || QWEN_MODEL : model
  console.log(`[callClaude] ${label}: starting (model=${selectedModel})`)

  let message: TransportMessage | undefined
  let success = true
  let errorMessage: string | undefined

  try {
    if (isQwenTransportEnabled()) {
      message = await callQwen<T>({
        system,
        userContent,
        schema: schema as unknown as Record<string, unknown>,
        label,
      })
    } else {
      anthropic ??= new Anthropic()
      message = await anthropic.messages.create({
        model,
        max_tokens: 8192,
        system,
        tools: [{
          name: 'return_result',
          description: 'Return the structured analysis result',
          input_schema: schema,
        }],
        tool_choice: { type: 'tool', name: 'return_result' },
        messages: [{ role: 'user', content: userContent }],
      })
    }
  } catch (err) {
    success = false
    errorMessage = err instanceof Error ? err.message : 'LLM transport failed'
    throw err
  } finally {
    const endTime = new Date()
    const elapsed = Date.now() - start

    // Log trace if context provided
    if (context?.userId) {
      const phase = label.startsWith('principle-') ? 'principle' : label
      await logLLMTrace({
        analysis_id: context.analysisId,
        analysis_run_id: context.analysisRunId,
        user_id: context.userId,
        call_label: label,
        model: selectedModel,
        phase,
        started_at: startTime.toISOString(),
        completed_at: endTime.toISOString(),
        latency_ms: elapsed,
        input_tokens: message?.usage.input_tokens || 0,
        output_tokens: message?.usage.output_tokens || 0,
        total_tokens: (message?.usage.input_tokens || 0) + (message?.usage.output_tokens || 0),
        request_payload: {
          system: system.substring(0, 500) + '...', // Truncate for storage
          userContent: userContent.substring(0, 500) + '...',
          schema: schema,
        },
        response_payload: {
          stop_reason: message?.stop_reason || 'error',
          content: message?.content || [],
          usage: message?.usage || { input_tokens: 0, output_tokens: 0 },
        },
        stop_reason: message?.stop_reason || 'error',
        success,
        error_message: errorMessage,
      }, context.supabase)
    }
  }

  if (!message) {
    throw new Error(`Claude API call failed for ${label}`)
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`[callClaude] ${label}: completed in ${elapsed}s (stop=${message.stop_reason}, in=${message.usage.input_tokens} out=${message.usage.output_tokens})`)

  const toolBlock = message.content.find(b => b.type === 'tool_use')
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error(`Claude did not return a tool_use block for ${label} (stop_reason=${message.stop_reason})`)
  }

  return toolBlock.input as T
}

// ─── Phase 1: Parse Protocol ────────────────────────────────────

interface ParseResult {
  protocolTitle: string
  chemistrySubdomain: string
  steps: AnalysisStep[]
  inputWarnings?: string[]
  error?: string
  message?: string
}

async function parseProtocol(protocolText: string, context?: CallContext): Promise<ParseResult> {
  console.log('Phase 1: Parsing protocol...')
  const prompt = process.env.GCAI_ENGINE_CANDIDATE === '1' ? CANDIDATE_PARSE_SYSTEM_PROMPT : PARSE_SYSTEM_PROMPT
  const result = await callClaude<ParseResult>(prompt, protocolText, PARSE_SCHEMA, 'parse', SONNET, context)

  if (result.error === 'not_chemistry') {
    throw new NotChemistryError(result.message || 'Not a chemistry protocol')
  }

  if (!Array.isArray(result.steps) || result.steps.length === 0 || result.steps.some(step =>
    !step || typeof step.description !== 'string' || !Array.isArray(step.chemicals) ||
    step.chemicals.some(chemical => !chemical || typeof chemical.name !== 'string' || !chemical.name.trim())
  )) {
    throw new Error('Protocol parsing returned no usable steps')
  }

  result.steps = normalizeParsedMaterials(result.steps)

  if (process.env.GCAI_ENGINE_CANDIDATE === '1') {
    const grounded = groundDeclaredProducts(result.steps, protocolText)
    result.steps = grounded.steps
    result.inputWarnings = grounded.warnings
    for (const step of result.steps) {
      step.conditions ??= { temperature: null, duration: null, atmosphere: null }
      for (const chemical of step.chemicals) {
        chemical.quantityKg = null
        chemical.quantityMl = null
      }
    }
  }

  console.log(`Phase 1 complete: "${result.protocolTitle}" — ${result.steps.length} steps parsed`)
  return result
}

// ─── Phase 2: Evaluate 12 Principles in Parallel ────────────────

interface PrincipleResult {
  principleNumber: number
  recommendations: Recommendation[]
}

async function evaluatePrinciple(
  principleNumber: number,
  steps: AnalysisStep[],
  candidates: EvidenceBackedCandidate[],
  context?: CallContext
): Promise<PrincipleResult> {
  const principle = PRINCIPLES.find(p => p.number === principleNumber)!
  const systemPrompt = buildPrinciplePrompt(principle, steps)
  const stepsJson = JSON.stringify(steps, null, 2)
  const candidateJson = JSON.stringify(candidates.map(candidate => ({
    id: candidate.id,
    kind: candidate.kind,
    target: candidate.target,
    proposedAlternative: candidate.proposedAlternative,
    evidenceIds: candidate.evidence.map(evidence => evidence.id),
    eligibility: candidate.evidenceAssessment,
  })), null, 2)

  return callClaude<PrincipleResult>(
    systemPrompt,
    `Analyze these protocol steps against Principle ${principleNumber}. You may only phrase one of the supplied evidence-backed candidates; do not invent targets, alternatives, or conditions. Preserve constraints when the candidate is constrained.\n\nProtocol steps:\n${stepsJson}\n\nEligible candidates:\n${candidateJson}`,
    PRINCIPLE_SCHEMA,
    `principle-${principleNumber}`,
    SONNET,
    context,
  )
}

function principleNumbersForCandidate(candidate: EvidenceBackedCandidate): number[] {
  return candidate.kind === 'substitution' && candidate.target.role?.toLowerCase() === 'solvent' ? [5] : []
}

function candidateMatchesRecommendation(candidate: EvidenceBackedCandidate, recommendation: Recommendation): boolean {
  return candidate.target.stepNumber === recommendation.stepNumber
    && candidate.target.sourceChemical?.trim().toLowerCase() === recommendation.original.chemical.trim().toLowerCase()
    && candidate.proposedAlternative?.trim().toLowerCase() === recommendation.alternative.chemical.trim().toLowerCase()
}

async function evaluateAllPrinciples(
  steps: AnalysisStep[],
  candidates: EvidenceBackedCandidate[],
  onProgress?: (event: ProgressEvent) => void,
  context?: CallContext
): Promise<Recommendation[]> {
  // Phrase only dispositions that can become actionable or constrained cards.
  // analogous_only / insufficient_evidence are attached as deterministic hypotheses later.
  const phraseable = candidates.filter(candidate => isPhraseableDisposition(candidate.evidenceAssessment.disposition))
  const candidatesByPrinciple = new Map(PRINCIPLES.map(principle => [
    principle.number,
    phraseable.filter(candidate => principleNumbersForCandidate(candidate).includes(principle.number)),
  ]))
  const activePrinciples = PRINCIPLES.filter(principle => (candidatesByPrinciple.get(principle.number)?.length ?? 0) > 0)

  if (activePrinciples.length === 0) {
    console.info('[pipeline] No phraseable evidence-backed solvent candidates for model wording.')
    return []
  }

  const batchSize = process.env.GCAI_ENGINE_CANDIDATE === '1' ? 2 : activePrinciples.length
  console.log(`Phase 2: Phrasing ${phraseable.length} evidence-backed candidates across ${activePrinciples.length} principles...`)
  const batches: PrincipleDefinition[][] = []
  for (let index = 0; index < activePrinciples.length; index += batchSize) {
    batches.push(activePrinciples.slice(index, index + batchSize))
  }

  const allRecommendations: Recommendation[] = []
  let succeeded = 0

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx]
    for (const p of batch) onProgress?.({ type: 'principle', number: p.number, name: p.name, status: 'evaluating' })

    const batchResults = await Promise.allSettled(
      batch.map(p => evaluatePrinciple(p.number, steps, candidatesByPrinciple.get(p.number) ?? [], context))
    )

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j]
      const principle = batch[j]
      if (result.status !== 'fulfilled') {
        console.warn(`Principle ${principle.number} evaluation failed:`, result.reason)
        onProgress?.({ type: 'principle', number: principle.number, name: principle.name, status: 'failed' })
        continue
      }
      succeeded++
      const allowed = candidatesByPrinciple.get(principle.number) ?? []
      const recs = (result.value.recommendations ?? [])
        .filter((rec: unknown): rec is Recommendation => typeof rec === 'object' && rec !== null)
        .filter(rec => allowed.some(candidate => candidateMatchesRecommendation(candidate, rec)))
      for (const rec of recs) {
        if (!Array.isArray(rec.principleNumbers) || rec.principleNumbers.length === 0) rec.principleNumbers = [principle.number]
        if (!Array.isArray(rec.principleNames) || rec.principleNames.length === 0) rec.principleNames = [principle.name]
      }
      allRecommendations.push(...recs)
      onProgress?.({ type: 'principle', number: principle.number, name: principle.name, status: 'complete', recommendations: recs.length })
    }
  }

  if (succeeded === 0) throw new Error('All evidence-backed recommendation evaluations failed')
  return allRecommendations
}

// ─── Phase 3: Assemble ──────────────────────────────────────────

interface AssembleResult {
  revisedProtocol: string
  overallAssessment: {
    greenPrinciplesViolated: number[]
    mostImpactfulChange: string
    experimentalValidationNeeded: boolean
    disclaimer: string
    processComplexity?: {
      score: number
      metrics: {
        transfer_count: number
        vessel_count: number
        prep_count: number
        purification_count: number
        step_count: number
      }
      level: string
    }
  }
}

async function assembleResult(
  protocolText: string,
  steps: AnalysisStep[],
  recommendations: Recommendation[],
  context?: CallContext,
  withheldCount = 0,
): Promise<AssembleResult> {
  console.log('Phase 3: Assembling revised protocol...')

  // If no application-eligible recommendations, do not invent a green claim.
  if (recommendations.length === 0) {
    const withheld = withheldCount > 0
    return {
      revisedProtocol: protocolText,
      overallAssessment: {
        greenPrinciplesViolated: [],
        mostImpactfulChange: withheld
          ? 'No application-eligible change. Visible hypotheses were not applied.'
          : 'No evidence-backed change was identified. That is not a claim the protocol is already green.',
        experimentalValidationNeeded: withheld,
        disclaimer: withheld
          ? 'CHEM21 guidance and literature that is only analogous or deferred do not establish a reaction-safe substitution. The original protocol is unchanged.'
          : 'No solvent intervention cleared the evidence gate. Hazardous materials may still be present. The original protocol is unchanged.',
      },
    }
  }

  const systemPrompt = buildAssemblePrompt(protocolText, steps, recommendations)

  try {
    const result = await callClaude<AssembleResult>(systemPrompt, 'Generate the revised protocol and overall assessment based on the recommendations above.', ASSEMBLE_SCHEMA, 'assemble', SONNET, context)
    console.log('Phase 3 complete')
    return result
  } catch (err) {
    // Graceful degradation: if assembly fails, return without revised protocol
    console.error('Phase 3 failed, returning without revised protocol:', err)
    const violatedPrinciples = [...new Set(recommendations.flatMap(r => r.principleNumbers))].sort()
    return {
      revisedProtocol: '',
      overallAssessment: {
        greenPrinciplesViolated: violatedPrinciples,
        mostImpactfulChange: recommendations[0]
          ? `Replace ${recommendations[0].original.chemical} with ${recommendations[0].alternative.chemical}`
          : 'See individual recommendations',
        experimentalValidationNeeded: true,
        disclaimer: 'These recommendations are based on published literature and established green chemistry principles. Experimental validation is required before adopting any changes. Yields, selectivity, and purity may be affected.',
      },
    }
  }
}

// ─── Evidence Tier & Ranking ─────────────────────────────────────

export const SEVERITY_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 }
export const TIER_MULTIPLIER: Record<string, number> = { sourced: 1.5, inferred: 1.0 }

export function deriveEvidenceTier(rec: Recommendation): 'sourced' | 'inferred' {
  return (rec.evidence?.citations?.length ?? 0) > 0 ? 'sourced' : 'inferred'
}

export function rankRecommendations(recs: Recommendation[]): Recommendation[] {
  return [...recs].sort((a, b) => {
    const scoreA = (SEVERITY_WEIGHT[a.severity] ?? 1) * (TIER_MULTIPLIER[a.evidenceTier ?? 'inferred'] ?? 1)
    const scoreB = (SEVERITY_WEIGHT[b.severity] ?? 1) * (TIER_MULTIPLIER[b.evidenceTier ?? 'inferred'] ?? 1)
    if (scoreB !== scoreA) return scoreB - scoreA
    // Tiebreak: sourced wins
    if (a.evidenceTier === 'sourced' && b.evidenceTier !== 'sourced') return -1
    if (b.evidenceTier === 'sourced' && a.evidenceTier !== 'sourced') return 1
    return 0
  })
}

// Phase 2.7 model re-evaluation removed: eligibility is decided before wording and fail-closed.

// ─── Deduplication ───────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1 }
const CONFIDENCE_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1 }

interface MergeSlot {
  /** The winning recommendation (highest severity, then highest confidence) */
  best: Recommendation
  /** All issue texts collected, keyed by principle to avoid duplicates */
  issuesByPrinciple: Map<number, string>
  /** All alternatives seen, keyed by chemical name to avoid duplicates */
  alternativesByChemical: Map<string, Recommendation['alternative']>
}

function deduplicateRecommendations(
  recs: Recommendation[],
  context?: CallContext
): { deduped: Recommendation[]; mergeMap: Record<string, number[]> } {
  const map = new Map<string, MergeSlot>()
  const mergeMap: Record<string, number[]> = {}

  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i]
    // Same swap (or warning) for the same chemicals collapses across steps.
    // DMF→MeCN in two steps is one card; hexane→heptane twice is one card.
    const from = rec.original.chemical.toLowerCase()
    const to = rec.alternative.chemical.toLowerCase()
    const kind = rec.cardKind === 'warning' ? 'warning' : 'swap'
    const key = kind === 'warning' ? `warning:${from}` : `${kind}:${from}:${to}`
    const existing = map.get(key)

    if (!existing) {
      const issuesByPrinciple = new Map<number, string>()
      for (const pn of rec.principleNumbers) {
        issuesByPrinciple.set(pn, rec.original.issue)
      }
      const alternativesByChemical = new Map<string, Recommendation['alternative']>()
      alternativesByChemical.set(rec.alternative.chemical.toLowerCase(), rec.alternative)
      map.set(key, { best: { ...rec }, issuesByPrinciple, alternativesByChemical })
      mergeMap[key] = [i]
      continue
    }

    // Merge principle numbers and names
    for (const pn of rec.principleNumbers) {
      if (!existing.best.principleNumbers.includes(pn)) {
        existing.best.principleNumbers.push(pn)
      }
      // Track issue text per principle (first one wins — avoids concatenation bloat)
      if (!existing.issuesByPrinciple.has(pn)) {
        existing.issuesByPrinciple.set(pn, rec.original.issue)
      }
    }
    for (const name of rec.principleNames) {
      if (!existing.best.principleNames.includes(name)) {
        existing.best.principleNames.push(name)
      }
    }

    // Collect alternative if it's a genuinely different suggestion
    // Use substring containment to avoid near-duplicates like "DMSO" vs "DMSO or Cyrene"
    const altName = rec.alternative.chemical.toLowerCase()
    const isDuplicate = Array.from(existing.alternativesByChemical.keys()).some(
      existingKey => existingKey.includes(altName) || altName.includes(existingKey)
    )
    if (!isDuplicate) {
      existing.alternativesByChemical.set(altName, rec.alternative)
    }

    const incomingBeatsBest =
      SEVERITY_ORDER[rec.severity] > SEVERITY_ORDER[existing.best.severity] ||
      (
        SEVERITY_ORDER[rec.severity] === SEVERITY_ORDER[existing.best.severity] &&
        CONFIDENCE_ORDER[rec.confidenceLevel] > CONFIDENCE_ORDER[existing.best.confidenceLevel]
      )

    // Promote severity and confidence to the highest seen
    if (SEVERITY_ORDER[rec.severity] > SEVERITY_ORDER[existing.best.severity]) {
      existing.best.severity = rec.severity
    }
    if (CONFIDENCE_ORDER[rec.confidenceLevel] > CONFIDENCE_ORDER[existing.best.confidenceLevel]) {
      existing.best.confidenceLevel = rec.confidenceLevel
    }

    // Replace the winner's issue/alternative if the incoming rec has higher severity
    // (so the top-level fields reflect the most important concern, not the first one seen)
    if (incomingBeatsBest) {
      existing.best.original.issue = rec.original.issue
      existing.best.alternative = rec.alternative
    }
  }

  // Finalize: pick the best issue text (from the highest-severity principle)
  // and merge alternative suggestions into the rationale
  const results: Recommendation[] = []
  for (const slot of Array.from(map.values())) {
    const rec = slot.best

    // Use the issue from the highest-numbered principle that contributed
    // (higher severity principles already won via the promote logic above)
    // Just make sure it's not the concatenated mess
    const issueTexts = [...slot.issuesByPrinciple.values()]
    if (issueTexts.length > 0) {
      // Keep the existing best issue (set by severity promotion above)
      // — don't concatenate
    }

    // If multiple distinct alternatives were suggested, append them to the rationale
    const allAlts = [...slot.alternativesByChemical.values()]
    if (allAlts.length > 1) {
      // Primary alternative is already set on rec.alternative
      // Add others as a note in the rationale
      const primaryKey = rec.alternative.chemical.toLowerCase()
      const otherAlts = allAlts.filter(a => a.chemical.toLowerCase() !== primaryKey)
      if (otherAlts.length > 0) {
        const otherNames = otherAlts.map(a => a.chemical).join(', ')
        rec.alternative.rationale += ` Also consider: ${otherNames}.`
      }
    }

    results.push(rec)
  }

  // Sort by step number, then severity (high first)
  const deduped = results.sort((a, b) =>
    a.stepNumber - b.stepNumber || SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
  )

  for (const recommendation of deduped) {
    recommendation.id ||= randomUUID()
  }

  // Log dedup trace if context provided
  if (context?.userId) {
    void logDedupTrace({
      analysis_id: context.analysisId,
      analysis_run_id: context.analysisRunId,
      user_id: context.userId,
      raw_recommendations: recs,
      deduped_recommendations: deduped,
      merge_map: mergeMap,
      dedup_rules: 'severity+confidence',
    }, context.supabase)
  }

  return { deduped, mergeMap }
}

// ─── Main Pipeline ──────────────────────────────────────────────

export async function analyzeProtocol(
  protocolText: string,
  onProgress?: (event: ProgressEvent) => void,
  context?: CallContext
): Promise<AnalysisResult> {
  // Phase 1: Parse
  onProgress?.({ type: 'phase', phase: 1, message: 'Parsing protocol...' })
  const parsed = await parseProtocol(protocolText, context)
  onProgress?.({ type: 'phase', phase: 1, message: `Parsed "${parsed.protocolTitle}" — ${parsed.steps.length} steps` })

  // Phase 1.5: Rationalize quantities + deterministic scoring (if service available)
  let deterministicScores: DeterministicScores | undefined
  let enrichedChemicals: EnrichedChemical[] | undefined
  let wasteAnalysis: WasteAnalysis | undefined
  const unresolvedChemicals = new Set<string>()
  const indefiniteChemicals = new Set<string>()

  const serviceUp = await isServiceAvailable()
  if (serviceUp) {
    // Rationalize: convert all chemicals to g/kg/mol
    onProgress?.({ type: 'phase', phase: 2, message: 'Converting quantities...' })
    const allChemicals = parsed.steps.flatMap(step =>
      step.chemicals.map(c => ({ name: c.name, quantity: c.quantity || '' }))
    )
    const batchResult = await batchConvert(allChemicals)
    const prepared = prepareChemicalInputs(parsed.steps, batchResult)
    enrichedChemicals = prepared.enrichedChemicals
    for (const name of prepared.unresolvedChemicals) unresolvedChemicals.add(name)
    for (const name of prepared.indefiniteChemicals) indefiniteChemicals.add(name)

    // A missing or indefinite material limits only principles that require that
    // material's reference data. It must not suppress protocol-level scoring
    // (including LLM-assisted P1/P2/P8/P11) for the whole analysis.
    if (batchResult) {
      console.info('[chemistry] scoring after batch', {
        batchResults: batchResult.results.length,
        unresolvedChemicals: unresolvedChemicals.size,
        indefiniteChemicals: indefiniteChemicals.size,
      })
      onProgress?.({ type: 'phase', phase: 2, message: 'Scoring against 12 principles...' })
    const scoreChemicals = prepared.scoreChemicals

    const scoreResult = await scoreProtocol({
      chemicals: scoreChemicals,
      steps: parsed.steps.map(s => ({
        stepNumber: s.stepNumber,
        description: s.description,
        chemicals: s.chemicals.map(c => ({ name: c.name, role: c.role })),
        conditions: s.conditions,
      })),
      protocol_text: protocolText,
    })

    if (scoreResult) {
      deterministicScores = scoreResult
      // v0.6: capture structured waste analysis
      if (scoreResult.waste_analysis) {
        wasteAnalysis = scoreResult.waste_analysis as unknown as WasteAnalysis
        console.log(`Waste analysis: grade ${wasteAnalysis.summary?.grade} (score ${wasteAnalysis.summary?.wasteImpactScore}/10)`)
      }
      console.log(`Deterministic scoring complete: grade ${scoreResult.grade} (${scoreResult.total_score}/${scoreResult.max_possible})`)

      // Stream individual scores to the UI
      for (const s of scoreResult.scores) {
        onProgress?.({
          type: 'score',
          principle: s.principle_number,
          name: s.principle_name,
          score: s.score,
          confidence: s.confidence,
        })
      }
    }
    }
  } else {
    console.warn('[pipeline] Chemistry service unavailable — skipping deterministic scoring')
  }

  // Evidence retrieval precedes wording. A result can be useful with zero eligible
  // changes, but an unsupported model suggestion is never an application candidate.
  onProgress?.({ type: 'phase', phase: 2, message: 'Finding evidence-backed intervention candidates...' })
  const seedCandidates = buildEvidenceBackedCandidates({
    steps: parsed.steps,
    enrichedChemicals: enrichedChemicals ?? [],
    evidenceByCandidate: new Map(),
  })
  const evidenceByCandidate = new Map<string, LiteratureEvidenceMatch[]>()
  const deferredCandidateKeys = new Set<string>()
  await Promise.all(seedCandidates.map(async candidate => {
    const alternative = candidate.proposedAlternative
    const source = candidate.target.sourceChemical
    if (!alternative || !source) return
    const key = evidenceCandidateKey(candidate.target.occurrenceId, alternative)
    const step = parsed.steps.find(item => item.stepNumber === candidate.target.stepNumber)
    try {
      evidenceByCandidate.set(key, await searchLiteratureEvidence({
        query: boundLiteratureQuery(`Solvent substitution from ${source} to ${alternative}; role ${candidate.target.role}; procedure context ${step?.description ?? ''}`),
        limit: 5,
        threshold: 0.25,
      }))
    } catch (error) {
      console.warn(`[pipeline] Evidence retrieval deferred for ${key}:`, error)
      deferredCandidateKeys.add(key)
    }
  }))
  const evidenceCandidates = buildEvidenceBackedCandidates({
    steps: parsed.steps,
    enrichedChemicals: enrichedChemicals ?? [],
    evidenceByCandidate,
    deferredCandidateKeys,
  })

  // Phase 2: phrase only direct, role- and occurrence-bounded candidates.
  const rawRecommendations = await evaluateAllPrinciples(parsed.steps, evidenceCandidates, onProgress, context)
  for (const recommendation of rawRecommendations) {
    const candidate = evidenceCandidates.find(item => candidateMatchesRecommendation(item, recommendation))
    if (!candidate) continue
    recommendation.evidenceCandidateId = candidate.id
    recommendation.evidenceAssessment = candidate.evidenceAssessment
    recommendation.evidence = {
      why_flagged: [],
      why_replacement: candidate.evidence.map(match => ({
        chemical: recommendation.alternative.chemical,
        source: match.title,
        content: match.quote,
      })),
      citations: candidate.evidence.map(citationFromEvidenceMatch),
      sdsReferences: buildSdsReferences(recommendation.original.chemical),
    }
  }

  // Deterministic hypothesis cards for analogous_only / insufficient_evidence (visible, not applicable).
  const hypothesisRecommendations = evidenceCandidates
    .map(buildHypothesisRecommendation)
    .filter((rec): rec is Recommendation => rec !== null)

  // Recommendations are already evidence-bounded. Do not use a second retrieval
  // or model re-evaluation to rehabilitate an unsupported model-generated swap.

  // Deduplicate: merge recommendations for the same chemical in the same step
  const { deduped: recommendations } = deduplicateRecommendations(
    [...rawRecommendations, ...hypothesisRecommendations],
    context,
  )
  console.log(`Deduplication: ${rawRecommendations.length} phrased + ${hypothesisRecommendations.length} hypotheses → ${recommendations.length} merged`)
  onProgress?.({ type: 'phase', phase: 2, message: `Found ${recommendations.length} recommendations` })

  // Attach evidence to recommendations based on enriched chemical data
  for (const rec of recommendations) {
    const enriched = enrichedChemicals?.find(e => 
      e.name.toLowerCase() === rec.original.chemical.toLowerCase() ||
      rec.original.chemical.toLowerCase().includes(e.name.toLowerCase()) ||
      e.name.toLowerCase().includes(rec.original.chemical.toLowerCase())
    )
    
    if (enriched) {
      const why_flagged = (enriched.ghs_hazards || []).map(h => ({
        source: h.source,
        content: `${h.code}: ${h.description}`
      }))
      
      const why_replacement = (enriched.green_alternatives || []).map(a => ({
        chemical: a.chemical,
        source: a.source,
        content: a.content
      }))
      
      if (why_flagged.length > 0 || why_replacement.length > 0) {
        const existingCitations = rec.evidence?.citations ?? []
        const newCitations = enriched.citations || []
        // Merge: keep Phase 2.5 citations; append enriched ones not already present
        const mergedCitations = [...existingCitations]
        for (const c of newCitations) {
          const alreadyExists = mergedCitations.some(e => e.source_id === c.source_id)
          if (!alreadyExists) mergedCitations.push(c)
        }
        rec.evidence = {
          why_flagged,
          why_replacement,
          citations: mergedCitations,
          // SDS links are supporting context only; scoring stays on GHS/PubChem.
          sdsReferences: buildSdsReferences(rec.original.chemical),
        }
      }
    }
  }

  // Legacy stats remain additive for persisted-result compatibility. Evidence
  // eligibility is established before wording and is never changed by an LLM.
  const reevaluationStats = { confirmed: 0, downgraded: 0, suppressed: 0, failed: 0 }
  const acsRecommendations = applyAcsGciprRecommendations({
    steps: parsed.steps,
    enrichedChemicals,
    recommendations,
  })
  const finalRecommendations = [
    ...acsRecommendations,
    ...buildHazardWarnings({
      enrichedChemicals,
      recommendations: acsRecommendations,
    }),
  ]

  // v0.6: Derive evidence tier and rerank
  for (const rec of finalRecommendations) {
    rec.evidenceTier = deriveEvidenceTier(rec)
  }
  finalRecommendations.sort((a, b) =>
    a.stepNumber - b.stepNumber || (SEVERITY_WEIGHT[b.severity] ?? 1) - (SEVERITY_WEIGHT[a.severity] ?? 1)
  )

  // v0.6: Derive primaryBenefit if the LLM didn't provide one
  for (const rec of finalRecommendations) {
    if (!rec.primaryBenefit) {
      // Derive from principle numbers
      const principles = rec.principleNumbers || []
      if (principles.includes(1)) {
        rec.primaryBenefit = 'Reduces direct chemical waste'
      } else if (principles.includes(3)) {
        rec.primaryBenefit = 'Lowers toxicity and hazard exposure'
      } else if (principles.includes(5)) {
        rec.primaryBenefit = 'Replaces hazardous solvent with safer alternative'
      } else if (principles.includes(6)) {
        rec.primaryBenefit = 'Reduces energy consumption'
      } else if (principles.includes(12)) {
        rec.primaryBenefit = 'Improves process safety'
      } else if (principles.includes(9)) {
        rec.primaryBenefit = 'Enables catalytic efficiency'
      } else {
        rec.primaryBenefit = 'Improves green chemistry profile'
      }
    }
  }

  // v0.6: Stamp citation metadata on all recommendations
  const metadata = getAnalysisMetadata()
  for (const rec of finalRecommendations) {
    rec.citationMetadata = {
      gcaiVersion: metadata.gcaiVersion,
      generatedAt: metadata.generatedAt,
    }
  }

  // Phase 3: Assemble revised protocol from application-eligible interventions only (fail-closed).
  onProgress?.({ type: 'phase', phase: 3, message: 'Assembling revised protocol...' })
  const recommendationsForAssemble = finalRecommendations.filter(rec =>
    isEligibleToReviseProcedure(rec.evidenceAssessment),
  )
  console.log(`Phase 3: Assembling from ${recommendationsForAssemble.length}/${finalRecommendations.length} application-eligible recommendations`)
  const assembled = await assembleResult(
    protocolText,
    parsed.steps,
    recommendationsForAssemble,
    context,
    finalRecommendations.length - recommendationsForAssemble.length,
  )

  // Attach process complexity from deterministic scores
  const complexityScore = deterministicScores?.scores.find(s => s.principle_number === 13)
  if (complexityScore) {
    assembled.overallAssessment.processComplexity = {
      score: complexityScore.score,
      metrics: {
        transfer_count: complexityScore.details.transfer_count as number,
        vessel_count: complexityScore.details.vessel_count as number,
        prep_count: complexityScore.details.prep_count as number,
        purification_count: complexityScore.details.purification_count as number,
        step_count: complexityScore.details.step_count as number,
      },
      level: complexityScore.details.complexity_level as string,
    }
  }

  onProgress?.({ type: 'phase', phase: 3, message: 'Assembly complete' })

  return {
    protocolTitle: parsed.protocolTitle,
    chemistrySubdomain: parsed.chemistrySubdomain,
    steps: parsed.steps,
    recommendations: finalRecommendations,
    ...(parsed.inputWarnings !== undefined ? { inputWarnings: parsed.inputWarnings } : {}),
    revisedProtocol: assembled.revisedProtocol,
    overallAssessment: assembled.overallAssessment,
    deterministicScores,
    enrichedChemicals,
    analysisMetadata: metadata,
    wasteAnalysis,
    chemistryDataStatus: {
      // If deterministic scoring never ran (service down / scoring failed) the
      // notice must show even when unresolvedChemicals is empty — an empty set
      // there means "we never checked," not "everything was fine."
      pending: unresolvedChemicals.size > 0 || deterministicScores === undefined,
      deterministicScoringAvailable: deterministicScores !== undefined,
      unresolvedChemicals: Array.from(unresolvedChemicals).sort((a, b) => a.localeCompare(b)),
      indefiniteChemicals: Array.from(indefiniteChemicals).sort((a, b) => a.localeCompare(b)),
      message: deterministicScores === undefined
        ? 'Deterministic chemistry scoring was unavailable because the chemistry service did not return a score. Re-run when the service is available.'
        : unresolvedChemicals.size > 0
          ? 'Partial deterministic scoring completed. Some material-level calculations are unavailable because chemical reference records could not be retrieved for the listed materials.'
          : indefiniteChemicals.size > 0
            ? 'Partial deterministic scoring completed. Materials with indefinite composition cannot be analyzed as single chemicals, so only dependent calculations may be unavailable.'
            : 'All requested chemical reference data was available from cache or bundled sources.',
    },
    // v0.7: Re-evaluation statistics
    reevaluationStats,
  }
}
