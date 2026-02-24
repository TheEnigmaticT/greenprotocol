import Anthropic from '@anthropic-ai/sdk'
import { AnalysisResult, AnalysisStep, Recommendation } from '@/lib/types'
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

async function callClaude<T>(system: string, userContent: string, schema: InputSchema, model: string = SONNET): Promise<T> {
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

  const toolBlock = message.content.find(b => b.type === 'tool_use')
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('Claude did not return a tool_use block')
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
  const result = await callClaude<ParseResult>(PARSE_SYSTEM_PROMPT, protocolText, PARSE_SCHEMA)

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

  return callClaude<PrincipleResult>(systemPrompt, `Analyze these protocol steps against Principle ${principleNumber}:\n\n${stepsJson}`, PRINCIPLE_SCHEMA)
}

async function evaluateAllPrinciples(steps: AnalysisStep[]): Promise<Recommendation[]> {
  console.log('Phase 2: Evaluating 12 principles in batches of 4...')

  // Batch into groups of 4 to avoid Anthropic rate limits
  const batches: PrincipleDefinition[][] = []
  for (let i = 0; i < PRINCIPLES.length; i += 4) {
    batches.push(PRINCIPLES.slice(i, i + 4))
  }

  const results: PromiseSettledResult<PrincipleResult>[] = []
  for (const batch of batches) {
    const batchResults = await Promise.allSettled(
      batch.map(p => evaluatePrinciple(p.number, steps))
    )
    results.push(...batchResults)
  }

  const allRecommendations: Recommendation[] = []
  let succeeded = 0
  let failed = 0

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const principleNum = PRINCIPLES[i].number

    if (result.status === 'fulfilled') {
      succeeded++
      const recs = result.value.recommendations || []
      // Ensure principleNumbers/Names are set correctly on each recommendation
      for (const rec of recs) {
        if (!rec.principleNumbers || rec.principleNumbers.length === 0) {
          rec.principleNumbers = [principleNum]
        }
        if (!rec.principleNames || rec.principleNames.length === 0) {
          rec.principleNames = [PRINCIPLES[i].name]
        }
      }
      allRecommendations.push(...recs)
    } else {
      failed++
      console.warn(`Principle ${principleNum} evaluation failed:`, result.reason)
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
    const result = await callClaude<AssembleResult>(systemPrompt, 'Generate the revised protocol and overall assessment based on the recommendations above.', ASSEMBLE_SCHEMA)
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

// ─── Main Pipeline ──────────────────────────────────────────────

export async function analyzeProtocol(protocolText: string): Promise<AnalysisResult> {
  // Phase 1: Parse
  const parsed = await parseProtocol(protocolText)

  // Phase 2: Evaluate all 12 principles in parallel
  const recommendations = await evaluateAllPrinciples(parsed.steps)

  // Phase 3: Assemble revised protocol
  const assembled = await assembleResult(protocolText, parsed.steps, recommendations)

  return {
    protocolTitle: parsed.protocolTitle,
    chemistrySubdomain: parsed.chemistrySubdomain,
    steps: parsed.steps,
    recommendations,
    revisedProtocol: assembled.revisedProtocol,
    overallAssessment: assembled.overallAssessment,
  }
}
