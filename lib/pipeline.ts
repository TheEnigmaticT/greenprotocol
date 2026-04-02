import Anthropic from '@anthropic-ai/sdk'
import { AnalysisResult, AnalysisStep, Recommendation, ProgressEvent, DeterministicScores, EnrichedChemical } from '@/lib/types'
import { batchConvert, scoreProtocol, isServiceAvailable } from '@/lib/chemistry-service'
import { PARSE_SYSTEM_PROMPT } from '@/lib/prompts/parse'
import { PRINCIPLES, buildPrinciplePrompt, type PrincipleDefinition } from '@/lib/prompts/principles'
import { buildAssemblePrompt } from '@/lib/prompts/assemble'

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

async function callClaude<T>(system: string, userContent: string, schema: InputSchema, label: string = 'unknown', model: string = SONNET): Promise<T> {
  const start = Date.now()
  console.log(`[callClaude] ${label}: starting (model=${model})`)

  const message = await anthropic.messages.create({
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

async function parseProtocol(protocolText: string): Promise<ParseResult> {
  console.log('Phase 1: Parsing protocol...')
  const result = await callClaude<ParseResult>(PARSE_SYSTEM_PROMPT, protocolText, PARSE_SCHEMA, 'parse')

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
  steps: AnalysisStep[]
): Promise<PrincipleResult> {
  const principle = PRINCIPLES.find(p => p.number === principleNumber)!
  const systemPrompt = buildPrinciplePrompt(principle, steps)
  const stepsJson = JSON.stringify(steps, null, 2)

  return callClaude<PrincipleResult>(systemPrompt, `Analyze these protocol steps against Principle ${principleNumber}:\n\n${stepsJson}`, PRINCIPLE_SCHEMA, `principle-${principleNumber}`)
}

async function evaluateAllPrinciples(
  steps: AnalysisStep[],
  onProgress?: (event: ProgressEvent) => void
): Promise<Recommendation[]> {
  console.log('Phase 2: Evaluating 12 principles in batches of 4...')

  // Run all 12 principles in parallel — heartbeat keeps the stream alive
  const batches: PrincipleDefinition[][] = [PRINCIPLES]

  const allRecommendations: Recommendation[] = []
  let succeeded = 0
  let failed = 0

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx]
    const batchNums = batch.map(p => p.number).join(',')
    console.log(`Phase 2: starting batch ${batchIdx + 1}/${batches.length} (principles ${batchNums})`)

    // Signal each principle in the batch as evaluating
    for (const p of batch) {
      onProgress?.({ type: 'principle', number: p.number, name: p.name, status: 'evaluating' })
    }

    const batchStart = Date.now()
    const batchResults = await Promise.allSettled(
      batch.map(p => evaluatePrinciple(p.number, steps))
    )
    console.log(`Phase 2: batch ${batchIdx + 1} completed in ${((Date.now() - batchStart) / 1000).toFixed(1)}s`)

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j]
      const principle = batch[j]

      if (result.status === 'fulfilled') {
        succeeded++
        const recs = result.value.recommendations || []
        for (const rec of recs) {
          if (!rec.principleNumbers || rec.principleNumbers.length === 0) {
            rec.principleNumbers = [principle.number]
          }
          if (!rec.principleNames || rec.principleNames.length === 0) {
            rec.principleNames = [principle.name]
          }
        }
        allRecommendations.push(...recs)
        onProgress?.({ type: 'principle', number: principle.number, name: principle.name, status: 'complete', recommendations: recs.length })
      } else {
        failed++
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
  }
}

async function assembleResult(
  protocolText: string,
  steps: AnalysisStep[],
  recommendations: Recommendation[]
): Promise<AssembleResult> {
  console.log('Phase 3: Assembling revised protocol...')

  // If no recommendations, skip the API call
  if (recommendations.length === 0) {
    return {
      revisedProtocol: protocolText, // unchanged
      overallAssessment: {
        greenPrinciplesViolated: [],
        mostImpactfulChange: 'No changes needed — this protocol already follows green chemistry principles.',
        experimentalValidationNeeded: false,
        disclaimer: 'This protocol was evaluated against all 12 Principles of Green Chemistry and no significant improvements were identified.',
      },
    }
  }

  const systemPrompt = buildAssemblePrompt(protocolText, steps, recommendations)

  try {
    const result = await callClaude<AssembleResult>(systemPrompt, 'Generate the revised protocol and overall assessment based on the recommendations above.', ASSEMBLE_SCHEMA, 'assemble')
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

function deduplicateRecommendations(recs: Recommendation[]): Recommendation[] {
  const map = new Map<string, MergeSlot>()

  for (const rec of recs) {
    // Key by step + original chemical (case-insensitive)
    const key = `${rec.stepNumber}:${rec.original.chemical.toLowerCase()}`
    const existing = map.get(key)

    if (!existing) {
      const issuesByPrinciple = new Map<number, string>()
      for (const pn of rec.principleNumbers) {
        issuesByPrinciple.set(pn, rec.original.issue)
      }
      const alternativesByChemical = new Map<string, Recommendation['alternative']>()
      alternativesByChemical.set(rec.alternative.chemical.toLowerCase(), rec.alternative)
      map.set(key, { best: { ...rec }, issuesByPrinciple, alternativesByChemical })
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

    // Promote severity and confidence to the highest seen
    if (SEVERITY_ORDER[rec.severity] > SEVERITY_ORDER[existing.best.severity]) {
      existing.best.severity = rec.severity
    }
    if (CONFIDENCE_ORDER[rec.confidenceLevel] > CONFIDENCE_ORDER[existing.best.confidenceLevel]) {
      existing.best.confidenceLevel = rec.confidenceLevel
    }

    // Replace the winner's issue/alternative if the incoming rec has higher severity
    // (so the top-level fields reflect the most important concern, not the first one seen)
    if (SEVERITY_ORDER[rec.severity] > SEVERITY_ORDER[existing.best.severity] ||
        (rec.severity === existing.best.severity &&
         CONFIDENCE_ORDER[rec.confidenceLevel] > CONFIDENCE_ORDER[existing.best.confidenceLevel])) {
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
  return results.sort((a, b) =>
    a.stepNumber - b.stepNumber || SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
  )
}

// ─── Main Pipeline ──────────────────────────────────────────────

export async function analyzeProtocol(
  protocolText: string,
  onProgress?: (event: ProgressEvent) => void
): Promise<AnalysisResult> {
  // Phase 1: Parse
  onProgress?.({ type: 'phase', phase: 1, message: 'Parsing protocol...' })
  const parsed = await parseProtocol(protocolText)
  onProgress?.({ type: 'phase', phase: 1, message: `Parsed "${parsed.protocolTitle}" — ${parsed.steps.length} steps` })

  // Phase 1.5: Rationalize quantities + deterministic scoring (if service available)
  let deterministicScores: DeterministicScores | undefined
  let enrichedChemicals: EnrichedChemical[] | undefined

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
            chem.quantityKg = conv.quantity_kg ?? chem.quantityKg
            enrichedChemicals.push({
              ...chem,
              molecular_weight: conv.molecular_weight ?? undefined,
              density_g_per_ml: conv.density_g_per_ml ?? undefined,
              smiles: conv.smiles ?? undefined,
              molecular_formula: conv.molecular_formula ?? undefined,
              data_source: conv.data_source,
            })
          }
          batchIdx++
        }
      }
      console.log(`Rationalization complete: ${batchResult.results.length} chemicals enriched`)
    }

    // Score: deterministic scoring against all 12 principles
    onProgress?.({ type: 'phase', phase: 2, message: 'Scoring against 12 principles...' })
    const scoreChemicals = parsed.steps.flatMap(step =>
      step.chemicals.map(c => {
        // Find the enriched version
        const enriched = enrichedChemicals?.find(e => e.name === c.name)
        return {
          name: c.name,
          role: c.role,
          quantity_g: c.quantityKg ? c.quantityKg * 1000 : null,
          quantity_kg: c.quantityKg,
          quantity_mol: enriched?.molecular_weight && c.quantityKg
            ? (c.quantityKg * 1000) / enriched.molecular_weight : null,
          molecular_weight: enriched?.molecular_weight ?? null,
          step_number: step.stepNumber,
        }
      })
    )

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
  } else {
    console.warn('[pipeline] Chemistry service unavailable — skipping deterministic scoring')
  }

  // Phase 2: Evaluate all 12 principles in parallel (LLM qualitative recommendations)
  onProgress?.({ type: 'phase', phase: 2, message: 'Evaluating 12 Green Chemistry Principles...' })
  const rawRecommendations = await evaluateAllPrinciples(parsed.steps, onProgress)

  // Deduplicate: merge recommendations for the same chemical in the same step
  const recommendations = deduplicateRecommendations(rawRecommendations)
  console.log(`Deduplication: ${rawRecommendations.length} raw → ${recommendations.length} merged`)
  onProgress?.({ type: 'phase', phase: 2, message: `Found ${recommendations.length} recommendations` })

  // Phase 3: Assemble revised protocol
  onProgress?.({ type: 'phase', phase: 3, message: 'Assembling revised protocol...' })
  const assembled = await assembleResult(protocolText, parsed.steps, recommendations)
  onProgress?.({ type: 'phase', phase: 3, message: 'Assembly complete' })

  return {
    protocolTitle: parsed.protocolTitle,
    chemistrySubdomain: parsed.chemistrySubdomain,
    steps: parsed.steps,
    recommendations,
    revisedProtocol: assembled.revisedProtocol,
    overallAssessment: assembled.overallAssessment,
    deterministicScores,
    enrichedChemicals,
  }
}
