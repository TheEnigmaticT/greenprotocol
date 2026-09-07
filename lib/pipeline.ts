import { randomUUID } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { AnalysisResult, AnalysisStep, Recommendation, ProgressEvent, DeterministicScores, EnrichedChemical, WasteAnalysis, type LiteratureEvidenceMatch } from '@/lib/types'
import { batchConvert, scoreProtocol, isServiceAvailable } from '@/lib/chemistry-service'
import { getAnalysisMetadata } from '@/lib/version'
import { PARSE_SYSTEM_PROMPT } from '@/lib/prompts/parse'
import {
  adaptStepsForLocalHelpers,
  flattenChemicalsForScore,
  isLocalParseEnabled,
  parseProtocolLocal,
  requireLocalParseModel,
} from '@/lib/local-parse'
import {
  isLocalPipelineEnabled,
  requireLocalPipelineModel,
  resolveLocalProvider,
} from '@/lib/local-llm'
import { completeLocalJsonValidated } from '@/lib/local-result-validate'
import { PRINCIPLES, buildPrinciplePrompt, type PrincipleDefinition } from '@/lib/prompts/principles'
import { buildAssemblePrompt } from '@/lib/prompts/assemble'
import {
  recommendationsForAssemble,
  recommendationsForLiteratureReevaluation,
  stampRecommendationKinds,
} from '@/lib/recommendation-kind'
import {
  collectHazardousInventory,
  countChemicalSwaps,
  inventoryRefsFromSteps,
  shouldRepairChemicalSwaps,
} from '@/lib/hazardous-inventory'
import { runChemicalSwapRepair } from '@/lib/chemical-swap-repair'
import { buildLiteratureQuery, citationFromEvidenceMatch, searchLiteratureEvidence } from '@/lib/literature-evidence'
import { buildSdsReferences } from '@/lib/sds'
import { buildReevaluatePrompt, REEVALUATE_SCHEMA } from '@/lib/prompts/reevaluate'
import { logLLMTrace, logDedupTrace } from '@/lib/trace'
import { mapSettledWithConcurrency } from '@/lib/concurrency'
import type { SupabaseClient } from '@supabase/supabase-js'

const SONNET = 'claude-sonnet-4-5-20250929'

const anthropic = new Anthropic()

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
          kind: { type: 'string', enum: ['chemical_swap', 'process_change', 'analytical'] },
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
      additionalProperties: false,
    },
  },
  required: ['revisedProtocol', 'overallAssessment'],
  additionalProperties: false,
}

interface CallContext {
  userId?: string
  analysisId?: string
  analysisRunId?: string
  supabase?: SupabaseClient
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

  // Fail-closed local pipeline: never fall through to Anthropic when enabled.
  if (isLocalPipelineEnabled()) {
    const localModel = requireLocalPipelineModel()
    const localProvider = resolveLocalProvider()
    console.log(`[callClaude] ${label}: local provider=${localProvider} model=${localModel}`)
    try {
      const local = await completeLocalJsonValidated<T>({
        system,
        user: userContent,
        schema: schema as unknown as Record<string, unknown>,
        model: localModel,
        label,
        numPredict: label === 'assemble' ? 16384 : (label.startsWith('principle-') || label.startsWith('reevaluate') ? 12288 : 8192),
      })
      const usage = local.usage ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
      if (local.degraded) {
        console.warn(`[callClaude] ${label}: degraded=true (OpenRouter hollow-retry)`)
      }
      if (context?.userId) {
        const endTime = new Date()
        const phase = label.startsWith('principle-') ? 'principle' : label
        await logLLMTrace({
          analysis_id: context.analysisId,
          analysis_run_id: context.analysisRunId,
          user_id: context.userId,
          call_label: label,
          model: localModel,
          phase,
          started_at: startTime.toISOString(),
          completed_at: endTime.toISOString(),
          latency_ms: Date.now() - start,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          total_tokens: usage.total_tokens,
          request_payload: {
            system: system.substring(0, 500) + '...',
            userContent: userContent.substring(0, 500) + '...',
            schema,
            provider: localProvider,
            degraded: Boolean(local.degraded),
          },
          response_payload: {
            provider: localProvider,
            degraded: Boolean(local.degraded),
            usage: {
              input_tokens: usage.input_tokens,
              output_tokens: usage.output_tokens,
              total_tokens: usage.total_tokens,
              ...(usage.reasoning_tokens != null ? { reasoning_tokens: usage.reasoning_tokens } : {}),
            },
            resultPreview: JSON.stringify(local.data).slice(0, 500),
          },
          stop_reason: local.degraded ? 'local_json_degraded' : 'local_json',
          success: true,
        }, context.supabase)
      }
      return local.data
    } catch (err) {
      if (context?.userId) {
        await logLLMTrace({
          analysis_id: context.analysisId,
          analysis_run_id: context.analysisRunId,
          user_id: context.userId,
          call_label: label,
          model: localModel,
          phase: label.startsWith('principle-') ? 'principle' : label,
          started_at: startTime.toISOString(),
          completed_at: new Date().toISOString(),
          latency_ms: Date.now() - start,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          request_payload: { provider: localProvider },
          response_payload: {},
          stop_reason: 'error',
          success: false,
          error_message: err instanceof Error ? err.message : String(err),
        }, context.supabase)
      }
      throw err
    }
  }

  console.log(`[callClaude] ${label}: starting (model=${model})`)

  let message: Anthropic.Messages.Message | undefined
  let success = true
  let errorMessage: string | undefined

  try {
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
  } catch (err) {
    success = false
    errorMessage = err instanceof Error ? err.message : String(err)
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
        model,
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
  error?: string
  message?: string
}

async function parseProtocol(protocolText: string, context?: CallContext): Promise<ParseResult> {
  console.log('Phase 1: Parsing protocol...')
  let result: ParseResult
  if (isLocalParseEnabled()) {
    const model = requireLocalParseModel()
    console.log(`[parse] local Ollama model=${model}`)
    const local = await parseProtocolLocal({ protocolText, model })
    result = {
      protocolTitle: local.protocolTitle,
      chemistrySubdomain: local.chemistrySubdomain,
      steps: local.steps,
      error: local.error,
      message: local.message,
    }
  } else {
    result = await callClaude<ParseResult>(PARSE_SYSTEM_PROMPT, protocolText, PARSE_SCHEMA, 'parse', SONNET, context)
  }

  if (result.error === 'not_chemistry') {
    throw new NotChemistryError(result.message || 'Not a chemistry protocol')
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
  context?: CallContext
): Promise<PrincipleResult> {
  const principle = PRINCIPLES.find(p => p.number === principleNumber)!
  const systemPrompt = buildPrinciplePrompt(principle, steps)
  const stepsJson = JSON.stringify(steps, null, 2)

  return callClaude<PrincipleResult>(systemPrompt, `Analyze these protocol steps against Principle ${principleNumber}:\n\n${stepsJson}`, PRINCIPLE_SCHEMA, `principle-${principleNumber}`, SONNET, context)
}

async function evaluateAllPrinciples(
  steps: AnalysisStep[],
  onProgress?: (event: ProgressEvent) => void,
  context?: CallContext
): Promise<Recommendation[]> {
  console.log('Phase 2: Evaluating 12 principles in batches of 4...')

  // Run all 12 principles in parallel — heartbeat keeps the stream alive
  const batches: PrincipleDefinition[][] = [PRINCIPLES]

  const allRecommendations: Recommendation[] = []
  let succeeded = 0

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx]
    const batchNums = batch.map(p => p.number).join(',')
    console.log(`Phase 2: starting batch ${batchIdx + 1}/${batches.length} (principles ${batchNums})`)

    // Signal each principle in the batch as evaluating
    for (const p of batch) {
      onProgress?.({ type: 'principle', number: p.number, name: p.name, status: 'evaluating' })
    }

    const batchStart = Date.now()
    let batchResults: PromiseSettledResult<PrincipleResult>[]
    // Ollama must stay serial (single local inference slot). OpenRouter (and Anthropic)
    // can evaluate all principles concurrently — wall time ≈ slowest principle.
    const serializePrinciples =
      isLocalPipelineEnabled() && resolveLocalProvider() === 'ollama'
    if (serializePrinciples) {
      console.log('Phase 2: serializing principles (ollama provider)')
      batchResults = []
      for (const p of batch) {
        try {
          batchResults.push({ status: 'fulfilled', value: await evaluatePrinciple(p.number, steps, context) })
        } catch (reason) {
          batchResults.push({ status: 'rejected', reason })
        }
      }
    } else {
      if (isLocalPipelineEnabled()) {
        console.log('Phase 2: parallel principles (openrouter provider)')
      }
      batchResults = await Promise.allSettled(
        batch.map(p => evaluatePrinciple(p.number, steps, context))
      )
    }
    console.log(`Phase 2: batch ${batchIdx + 1} completed in ${((Date.now() - batchStart) / 1000).toFixed(1)}s`)

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j]
      const principle = batch[j]

      if (result.status === 'fulfilled') {
        succeeded++
        // Local Path B: callClaude validates recommendations as an array (or throws →
        // rejected). Anthropic keeps historical soft coerce for missing recommendations.
        const rawRecs = result.value.recommendations || []
        // Guard against malformed recs (strings instead of objects)
        const recs = rawRecs.filter((r: unknown): r is Record<string, unknown> => typeof r === 'object' && r !== null)
        for (let i = 0; i < recs.length; i++) {
    const rec = recs[i]
          if (!Array.isArray(rec.principleNumbers) || rec.principleNumbers.length === 0) {
            rec.principleNumbers = [principle.number]
          }
          if (!Array.isArray(rec.principleNames) || rec.principleNames.length === 0) {
            rec.principleNames = [principle.name]
          }
        }
        allRecommendations.push(...recs)
        onProgress?.({ type: 'principle', number: principle.number, name: principle.name, status: 'complete', recommendations: recs.length })
      } else {
        console.warn(`Principle ${principle.number} evaluation failed:`, result.reason)
        onProgress?.({ type: 'principle', number: principle.number, name: principle.name, status: 'failed' })
      }
    }
  }

  console.log(`Phase 2 complete: ${succeeded}/12 principles evaluated, ${allRecommendations.length} recommendations`)

  if (succeeded === 0) {
    throw new Error('All 12 principle evaluations failed')
  }

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
  context?: CallContext
): Promise<AssembleResult> {
  console.log('Phase 3: Assembling revised protocol...')

  // Process/analytical tips must not enter assemble — substitutions only.
  const swapRecommendations = recommendationsForAssemble(recommendations)

  // If no chemical substitutions, skip the API call (tips alone do not revise text)
  if (swapRecommendations.length === 0) {
    return {
      revisedProtocol: protocolText, // unchanged
      overallAssessment: {
        greenPrinciplesViolated: [],
        mostImpactfulChange: recommendations.length === 0
          ? 'No changes needed — this protocol already follows green chemistry principles.'
          : 'No chemical substitutions to apply; process/analytical tips remain available for review.',
        experimentalValidationNeeded: recommendations.length > 0,
        disclaimer: recommendations.length === 0
          ? 'This protocol was evaluated against all 12 Principles of Green Chemistry and no significant improvements were identified.'
          : 'Process and analytical tips were identified but are not applied as chemical substitutions in the revised protocol.',
      },
    }
  }

  const systemPrompt = buildAssemblePrompt(protocolText, steps, swapRecommendations)

  try {
    const result = await callClaude<AssembleResult>(systemPrompt, 'Generate the revised protocol and overall assessment based on the recommendations above.', ASSEMBLE_SCHEMA, 'assemble', SONNET, context)
    console.log('Phase 3 complete')
    return result
  } catch (err) {
    // Graceful degradation: if assembly fails, return without revised protocol
    console.error('Phase 3 failed, returning without revised protocol:', err)
    const violatedPrinciples = [...new Set(swapRecommendations.flatMap(r => r.principleNumbers))].sort()
    return {
      revisedProtocol: '',
      overallAssessment: {
        greenPrinciplesViolated: violatedPrinciples,
        mostImpactfulChange: swapRecommendations[0]
          ? `Replace ${swapRecommendations[0].original.chemical} with ${swapRecommendations[0].alternative.chemical}`
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

// ─── Phase 2.7: Re-evaluation ───────────────────────────────────

export interface ReevaluationResult {
  action: 'confirm' | 'downgrade' | 'suppress'
  revisedConfidence: 'high' | 'medium' | 'low'
  revisedSeverity?: 'high' | 'medium' | 'low'
  revisedRationale: string
  evidenceAssessment: {
    supportsOriginalIssue: boolean
    supportsAlternative: boolean
    contextMatch: 'strong' | 'partial' | 'weak' | 'none'
    quantitativeData: boolean
  }
  concerns: string[]
  suppressionReason?: string
}

async function reevaluateRecommendation(
  recommendation: Recommendation,
  literatureEvidence: LiteratureEvidenceMatch[]
): Promise<ReevaluationResult | null> {
  try {
    const systemPrompt = buildReevaluatePrompt(recommendation, literatureEvidence)
    const result = await callClaude<ReevaluationResult>(
      systemPrompt,
      'Re-evaluate this recommendation based on the retrieved literature evidence.',
      REEVALUATE_SCHEMA as unknown as InputSchema,
      `reevaluate-step${recommendation.stepNumber}-${recommendation.original.chemical.substring(0, 15)}`
    )
    return result
  } catch (err) {
    console.warn(`[pipeline] Re-evaluation failed for ${recommendation.original.chemical}:`, err)
    return null
  }
}

function isCandidateOnlyEvidence(matches: LiteratureEvidenceMatch[]): boolean {
  return matches.length > 0 && matches.every(
    match => match.candidateStatus === 'candidate_pending_adjudication'
  )
}

const CANDIDATE_ONLY_CAVEAT =
  'Candidate-only evidence cannot independently confirm or suppress this intervention.'

function ensureCandidateOnlyConcern(concerns: string[]): string[] {
  if (concerns.some(c => /candidate-only/i.test(c))) {
    return concerns
  }
  return [...concerns, CANDIDATE_ONLY_CAVEAT]
}

export function enforceCandidateOnlyReevaluation(
  reevaluation: ReevaluationResult,
  matches: LiteratureEvidenceMatch[],
  localPipeline: boolean = isLocalPipelineEnabled(),
): ReevaluationResult {
  if (!isCandidateOnlyEvidence(matches)) {
    return reevaluation
  }

  // Soft mode for local pipeline: do not force-downgrade confirmations.
  if (localPipeline) {
    if (reevaluation.action === 'suppress') {
      // Preserve safety: never suppress on candidate-only evidence.
      return {
        ...reevaluation,
        action: 'downgrade',
        revisedConfidence: 'low',
        concerns: ensureCandidateOnlyConcern(reevaluation.concerns),
        suppressionReason: undefined,
      }
    }

    if (reevaluation.action === 'confirm') {
      const revisedConfidence =
        reevaluation.revisedConfidence === 'high' ? 'medium' : reevaluation.revisedConfidence
      return {
        ...reevaluation,
        revisedConfidence,
        concerns: ensureCandidateOnlyConcern(reevaluation.concerns),
      }
    }

    // downgrade: keep action/confidence, ensure candidate-only caveat
    return {
      ...reevaluation,
      concerns: ensureCandidateOnlyConcern(reevaluation.concerns),
    }
  }

  // Hard mode (local pipeline OFF): force downgrade unless already downgraded.
  if (reevaluation.action === 'downgrade') {
    return reevaluation
  }

  return {
    ...reevaluation,
    action: 'downgrade',
    revisedConfidence: 'low',
    concerns: [
      ...reevaluation.concerns,
      CANDIDATE_ONLY_CAVEAT,
    ],
    suppressionReason: undefined,
  }
}

/** OpenRouter / remote reeval concurrency (Ollama stays serial). */
const REEVAL_OPENROUTER_CONCURRENCY = 6

type ReevalItemOutcome =
  | { status: 'failed'; chemName: string; recommendation: Recommendation }
  | { status: 'suppress'; chemName: string; suppressionReason?: string }
  | {
      status: 'keep'
      chemName: string
      recommendation: Recommendation
      action: 'confirm' | 'downgrade'
      revisedConfidence: 'high' | 'medium' | 'low'
    }

async function reevaluateOneRecommendationItem(
  rec: Recommendation,
  index: number,
  total: number,
): Promise<ReevalItemOutcome> {
  const chemName = rec.original.chemical
  console.log(`Phase 2.7: [${index + 1}/${total}] Re-evaluating ${chemName}...`)

  const query = buildLiteratureQuery(rec.original.chemical, rec.alternative.chemical, rec.alternative.rationale)
  let literatureEvidence: LiteratureEvidenceMatch[] = []

  try {
    literatureEvidence = await searchLiteratureEvidence({
      query,
      limit: 5,
      threshold: 0.25,
    })
    console.log(`Phase 2.7: Found ${literatureEvidence.length} literature matches for ${chemName}`)
  } catch (err) {
    console.warn(`Phase 2.7: Literature retrieval failed for ${chemName}:`, err)
  }

  const reevaluationResult = await reevaluateRecommendation(rec, literatureEvidence)
  const reevaluation = reevaluationResult
    ? enforceCandidateOnlyReevaluation(reevaluationResult, literatureEvidence)
    : null

  if (!reevaluation) {
    return { status: 'failed', chemName, recommendation: rec }
  }

  if (reevaluation.action === 'suppress') {
    console.log(`Phase 2.7: SUPPRESSED ${chemName} — ${reevaluation.suppressionReason}`)
    return { status: 'suppress', chemName, suppressionReason: reevaluation.suppressionReason }
  }

  const updatedRec = { ...rec }
  updatedRec.confidenceLevel = reevaluation.revisedConfidence

  if (reevaluation.revisedSeverity) {
    updatedRec.severity = reevaluation.revisedSeverity
  }

  if (reevaluation.concerns.length > 0) {
    const concernsText = reevaluation.concerns.join('; ')
    updatedRec.alternative.caveats = updatedRec.alternative.caveats
      ? `${updatedRec.alternative.caveats}; ${concernsText}`
      : concernsText
  }

  updatedRec.alternative.rationale = reevaluation.revisedRationale

  if (!updatedRec.evidence) {
    updatedRec.evidence = { why_flagged: [], why_replacement: [], citations: [] }
  }
  // @ts-expect-error — adding non-standard field for evidence assessment metadata
  updatedRec.evidence.reevaluationMeta = reevaluation.evidenceAssessment

  const action = reevaluation.action === 'confirm' ? 'confirm' : 'downgrade'
  if (action === 'confirm') {
    console.log(`Phase 2.7: CONFIRMED ${chemName} (confidence: ${reevaluation.revisedConfidence})`)
  } else {
    console.log(`Phase 2.7: DOWNGRADED ${chemName} (confidence: ${reevaluation.revisedConfidence})`)
  }

  return {
    status: 'keep',
    chemName,
    recommendation: updatedRec,
    action,
    revisedConfidence: reevaluation.revisedConfidence,
  }
}

async function reevaluateAllRecommendations(
  recommendations: Recommendation[],
  onProgress?: (event: ProgressEvent) => void
): Promise<{ recommendations: Recommendation[]; stats: { confirmed: number; downgraded: number; suppressed: number; failed: number } }> {
  console.log(`Phase 2.7: Re-evaluating ${recommendations.length} recommendations against literature...`)
  onProgress?.({ type: 'phase', phase: 2, message: `Re-evaluating ${recommendations.length} recommendations...` })

  const stats = { confirmed: 0, downgraded: 0, suppressed: 0, failed: 0 }
  const keepRecommendations: Recommendation[] = []
  const total = recommendations.length

  // Ollama: serial (single local inference slot). OpenRouter / non-ollama: bounded parallel.
  // Phase 2.5 literature grounding already uses Promise.allSettled nearby.
  const serializeReeval =
    isLocalPipelineEnabled() && resolveLocalProvider() === 'ollama'

  const outcomes: ReevalItemOutcome[] = []
  if (serializeReeval) {
    console.log('Phase 2.7: serializing reevaluation (ollama provider)')
    for (let i = 0; i < total; i++) {
      outcomes.push(await reevaluateOneRecommendationItem(recommendations[i], i, total))
    }
  } else {
    if (isLocalPipelineEnabled()) {
      console.log(
        `Phase 2.7: parallel reevaluation (openrouter provider, concurrency=${REEVAL_OPENROUTER_CONCURRENCY})`,
      )
    }
    const settled = await mapSettledWithConcurrency(
      recommendations,
      REEVAL_OPENROUTER_CONCURRENCY,
      (rec, i) => reevaluateOneRecommendationItem(rec, i, total),
    )
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]
      if (result.status === 'fulfilled') {
        outcomes.push(result.value)
      } else {
        console.warn(`Phase 2.7: unexpected reevaluation worker failure:`, result.reason)
        outcomes.push({
          status: 'failed',
          chemName: recommendations[i].original.chemical,
          recommendation: recommendations[i],
        })
      }
    }
  }

  for (const outcome of outcomes) {
    if (outcome.status === 'failed') {
      stats.failed++
      keepRecommendations.push(outcome.recommendation)
      continue
    }
    if (outcome.status === 'suppress') {
      stats.suppressed++
      continue
    }
    if (outcome.action === 'confirm') stats.confirmed++
    else stats.downgraded++
    keepRecommendations.push(outcome.recommendation)
  }

  console.log(`Phase 2.7 complete: ${stats.confirmed} confirmed, ${stats.downgraded} downgraded, ${stats.suppressed} suppressed, ${stats.failed} failed`)
  onProgress?.({ type: 'phase', phase: 2, message: `Re-evaluation complete: ${stats.suppressed} recommendations suppressed` })

  return { recommendations: keepRecommendations, stats }
}

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
    // Key by step + original chemical + kind (case-insensitive)
    const key = `${rec.stepNumber}:${rec.original.chemical.toLowerCase()}:${rec.kind ?? 'chemical_swap'}`
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

    if (batchResult) {
      // Enrich the parsed chemicals with conversion results
      enrichedChemicals = []
      let batchIdx = 0
      for (const step of parsed.steps) {
        for (const chem of step.chemicals) {
          if (batchIdx < batchResult.results.length) {
            const conv = batchResult.results[batchIdx]
            // 'error' = the service threw while converting this chemical (e.g. the
            // June–Aug converter NameError). It must count as unresolved just like
            // 'not_found', otherwise a fully-broken batch reports zero problems.
            if (conv.data_source === 'indefinite') {
              indefiniteChemicals.add(conv.chemical_name || chem.name)
            } else if (conv.data_source === 'not_found' || conv.data_source === 'error' || conv.warnings.some(w => w.toLowerCase().includes('not found'))) {
              unresolvedChemicals.add(conv.chemical_name || chem.name)
            }
            chem.quantityKg = conv.quantity_kg ?? chem.quantityKg
            enrichedChemicals.push({
              ...chem,
              molecular_weight: conv.molecular_weight ?? undefined,
              density_g_per_ml: conv.density_g_per_ml ?? undefined,
              smiles: conv.smiles ?? undefined,
              molecular_formula: conv.molecular_formula ?? undefined,
              ghs_hazards: conv.ghs_hazards,
              green_alternatives: conv.green_alternatives,
              citations: conv.citations,
              data_source: conv.data_source,
            })
          }
          batchIdx++
        }
      }
      if (batchResult.results.length < allChemicals.length) {
        for (const missing of allChemicals.slice(batchResult.results.length)) {
          unresolvedChemicals.add(missing.name)
        }
      }
      console.log(`Rationalization complete: ${batchResult.results.length} chemicals enriched`)
    } else {
      // A failed batch must not silently become a score with null quantities.
      for (const chemical of allChemicals) unresolvedChemicals.add(chemical.name)
    }

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
    const localSteps = adaptStepsForLocalHelpers(protocolText, parsed.steps)
    const scoreChemicals = localSteps.flatMap(step =>
      step.chemicals.map(c => {
        const enriched = enrichedChemicals?.find(e => e.name === c.name)
        const parsedChem = parsed.steps
          .flatMap(s => s.chemicals)
          .find(pc => pc.name === c.name)
        return {
          name: c.name,
          role: c.role,
          quantity: c.quantity,
          quantity_g: parsedChem?.quantityKg ? parsedChem.quantityKg * 1000 : null,
          quantity_kg: parsedChem?.quantityKg ?? null,
          quantity_mol: enriched?.molecular_weight && parsedChem?.quantityKg
            ? (parsedChem.quantityKg * 1000) / enriched.molecular_weight : null,
          molecular_weight: enriched?.molecular_weight ?? null,
          step_number: step.stepNumber,
        }
      })
    )

    const scoreResult = await scoreProtocol({
      chemicals: scoreChemicals.length ? scoreChemicals : flattenChemicalsForScore(localSteps),
      steps: localSteps,
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

  // Phase 2: Evaluate all 12 principles in parallel (LLM qualitative recommendations)
  onProgress?.({ type: 'phase', phase: 2, message: 'Evaluating 12 Green Chemistry Principles...' })
  let rawRecommendations = stampRecommendationKinds(
    await evaluateAllPrinciples(parsed.steps, onProgress, context)
  )

  // Local-only: if hazardous inventory remains and Phase 2 emitted zero chemical_swap,
  // one repair LLM call must produce ≥1 true swap. Fail-closed on repair failure.
  if (isLocalPipelineEnabled()) {
    const hazardousInventory = collectHazardousInventory(
      inventoryRefsFromSteps(parsed.steps),
      enrichedChemicals,
    )
    const swapCountBefore = countChemicalSwaps(rawRecommendations)
    if (
      !shouldRepairChemicalSwaps({
        recommendations: rawRecommendations,
        hazardousInventory,
      })
    ) {
      console.log(
        `[swap-repair] skipped swaps=${swapCountBefore} hazardous=${hazardousInventory.length}`,
      )
    } else {
      console.log(
        `[swap-repair] triggered swaps=${swapCountBefore} hazardous=${hazardousInventory.length}` +
          ` names=${hazardousInventory.map((h) => h.name).join('|')}`,
      )
      onProgress?.({
        type: 'phase',
        phase: 2,
        message: 'Repairing missing chemical substitutions...',
      })
      const repaired = await runChemicalSwapRepair({
        recommendations: rawRecommendations,
        hazardousInventory,
        steps: parsed.steps,
      })
      if (repaired.status === 'succeeded') {
        rawRecommendations = repaired.recommendations
        console.log(
          `[swap-repair] succeeded added=${repaired.addedSwaps}` +
            ` total_swaps=${countChemicalSwaps(rawRecommendations)}`,
        )
      } else {
        console.warn(
          `[swap-repair] failed reason=${repaired.reason ?? 'unknown'}; keeping original tip set`,
        )
      }
    }
  }

  // Phase 2.5: Ground chemical_swap recommendations in literature via Vector Search
  // Process/analytical tips skip literature grounding (fail-closed: no tip→lit poisoning).
  onProgress?.({ type: 'phase', phase: 2, message: 'Grounding recommendations in literature...' })
  try {
    const litTargets = recommendationsForLiteratureReevaluation(rawRecommendations)
    const queries = litTargets.map(rec =>
      buildLiteratureQuery(rec.original.chemical, rec.alternative.chemical, rec.alternative.rationale)
    )

    const results = await Promise.allSettled(
      litTargets.map((rec, i) =>
        searchLiteratureEvidence({
          query: queries[i],
          limit: 3,
          threshold: 0.25,
        })
      )
    )

    for (let i = 0; i < litTargets.length; i++) {
      const result = results[i]
      if (result.status === 'rejected') {
        console.warn(`[pipeline] Phase 2.5 retrieval failed for ${litTargets[i].original.chemical}:`, result.reason)
        continue
      }
      const matches = result.value
      if (matches.length === 0) continue

      const rec = litTargets[i]
      if (!rec.evidence) {
        rec.evidence = { why_flagged: [], why_replacement: [], citations: [] }
      }
      const seenEvidenceIds = new Set(rec.evidence.citations.map(citation => citation.source_id))
      for (const match of matches) {
        if (seenEvidenceIds.has(match.id)) continue

        seenEvidenceIds.add(match.id)
        rec.evidence.citations.push(citationFromEvidenceMatch(match))
        rec.evidence.why_replacement.push({
          chemical: rec.alternative.chemical,
          source: match.title,
          content: `${match.candidateStatus === 'candidate_pending_adjudication' ? 'Candidate evidence — ' : ''}${match.quote}`,
        })
      }
    }
  } catch (err) {
    console.warn('[pipeline] Phase 2.5 skipped due to error:', err)
  }

  // Deduplicate: merge recommendations for the same chemical+kind in the same step
  const { deduped } = deduplicateRecommendations(rawRecommendations, context)
  const recommendations = stampRecommendationKinds(deduped)
  console.log(`Deduplication: ${rawRecommendations.length} raw → ${recommendations.length} merged`)
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

  // Phase 2.7: Re-evaluate recommendations against literature evidence
  // This is the two-pass pipeline: generate recommendations (Phase 2), then re-evaluate them (Phase 2.7)
  let reevaluationStats = { confirmed: 0, downgraded: 0, suppressed: 0, failed: 0 }
  let finalRecommendations = recommendations
  
  try {
    const swapRecs = recommendationsForLiteratureReevaluation(recommendations)
    const tipRecs = recommendations.filter(r => !swapRecs.includes(r))
    const reevalResult = await reevaluateAllRecommendations(swapRecs, onProgress)
    // Tips skip lit reevaluation; keep them as-is alongside reevaluated swaps.
    finalRecommendations = stampRecommendationKinds([
      ...reevalResult.recommendations,
      ...tipRecs,
    ])
    reevaluationStats = reevalResult.stats
  } catch (err) {
    console.warn('[pipeline] Phase 2.7 re-evaluation skipped due to error:', err)
  }

  // v0.6: Derive evidence tier and rerank
  for (const rec of finalRecommendations) {
    rec.evidenceTier = deriveEvidenceTier(rec)
  }
  finalRecommendations.sort((a, b) => {
    const scoreA = (SEVERITY_WEIGHT[a.severity] ?? 1) * (TIER_MULTIPLIER[a.evidenceTier ?? 'inferred'] ?? 1)
    const scoreB = (SEVERITY_WEIGHT[b.severity] ?? 1) * (TIER_MULTIPLIER[b.evidenceTier ?? 'inferred'] ?? 1)
    if (scoreB !== scoreA) return scoreB - scoreA
    if (a.evidenceTier === 'sourced' && b.evidenceTier !== 'sourced') return -1
    if (b.evidenceTier === 'sourced' && a.evidenceTier !== 'sourced') return 1
    return 0
  })

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

  // Phase 3: Assemble revised protocol
  onProgress?.({ type: 'phase', phase: 3, message: 'Assembling revised protocol...' })
  const assembled = await assembleResult(protocolText, parsed.steps, finalRecommendations)

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
