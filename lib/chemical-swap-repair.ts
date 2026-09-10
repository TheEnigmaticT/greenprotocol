/**
 * Local-only inventory-gated chemical_swap repair.
 * One LLM call when Phase 2 produced zero swaps but hazardous inventory remains.
 * Fail-closed: on any failure, keep the original tip set (never invent swaps in code).
 */
import { completeLocalJsonValidated } from '@/lib/local-result-validate'
import {
  baseChemicalName,
  isChemicalSwapRecommendation,
  stampRecommendationKinds,
} from '@/lib/recommendation-kind'
import type { HazardousInventoryItem } from '@/lib/hazardous-inventory'
import type { AnalysisStep, Recommendation } from '@/lib/types'
import {
  requireLocalPipelineModel,
  resolveLocalProvider,
} from '@/lib/local-llm'

const SWAP_REPAIR_SCHEMA = {
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
        required: ['stepNumber', 'original', 'alternative', 'severity', 'confidenceLevel', 'kind'],
      },
    },
  },
  required: ['principleNumber', 'recommendations'],
} as const

interface SwapRepairLlmResult {
  principleNumber: number
  recommendations: Recommendation[]
}

function normalizedInventoryName(value: string): string {
  return baseChemicalName(value).replace(/^(?:concentrated|conc\.?)\s+/i, '')
}

/** A repair can only replace a chemical actually identified by the inventory gate. */
export function isInventoryGroundedChemicalSwap(
  rec: Pick<Recommendation, 'original' | 'alternative'>,
  hazardousInventory: HazardousInventoryItem[],
): boolean {
  const original = normalizedInventoryName(rec.original?.chemical ?? '')
  const alternative = normalizedInventoryName(rec.alternative?.chemical ?? '')
  if (!original || !alternative || original === alternative) return false
  return hazardousInventory.some((item) => normalizedInventoryName(item.name) === original)
}

function buildSwapRepairSystemPrompt(hazardous: HazardousInventoryItem[]): string {
  const inventoryLines = hazardous.map((h) => {
    const step = h.stepNumber != null ? `step ${h.stepNumber}` : 'step unknown'
    const role = h.role ? `, role=${h.role}` : ''
    return `- ${h.name} (${step}${role}); classes=[${h.classes.join(', ')}]; signals=[${h.signals.join('; ')}]`
  })

  return `You are a green chemistry expert performing a focused chemical_swap repair pass.

CONTEXT:
Phase 2 already produced process_change / analytical tips, but ZERO true chemical_swap recommendations.
The protocol chemical inventory still contains hazardous substance classes that usually warrant at least one substance-level substitution.

HAZARDOUS INVENTORY (from chemical names / properties / enrichment — not from protocol title):
${inventoryLines.join('\n')}

TASK:
- Emit ONE or more recommendations with kind exactly "chemical_swap".
- Each chemical_swap MUST replace one inventory chemical above with a DIFFERENT base chemical name (not the same substance with a dose/parenthetical tip; not TLC/HPLC/monitoring; not microwave/temperature-only tips). This includes hazardous reagents and catalysts, not only solvents.
- Prefer established greener alternatives (CHEM21 solvents, milder acids, supported catalytic systems). Be conservative; do not invent unsafe or fictional reagents.
- Keep kind segregation: do NOT return process_change or analytical in this repair unless also including ≥1 valid chemical_swap. Prefer returning only chemical_swap items.
- Set principleNumbers/principleNames appropriately (often P3 Less Hazardous Chemical Syntheses and/or P5 Safer Solvents and Auxiliaries and/or P12 Inherently Safer Chemistry).
- Do NOT hardcode brand/trademark alternatives. Do NOT key off protocol title.

Return ONLY JSON matching:
{
  "principleNumber": 5,
  "recommendations": [
    {
      "stepNumber": <number>,
      "principleNumbers": [3, 5],
      "principleNames": ["Less Hazardous Chemical Syntheses", "Safer Solvents and Auxiliaries"],
      "severity": "high|medium|low",
      "kind": "chemical_swap",
      "original": { "chemical": "<inventory chemical name>", "issue": "<why hazardous>" },
      "alternative": {
        "chemical": "<different greener chemical>",
        "rationale": "<why greener>",
        "yieldImpact": "<expected impact>",
        "caveats": "<limitations>",
        "evidenceBasis": "<CHEM21 or published precedent>"
      },
      "confidenceLevel": "high|medium|low",
      "primaryBenefit": "<short concrete benefit>"
    }
  ]
}`
}

function normalizeRepairRecs(raw: Recommendation[]): Recommendation[] {
  return raw.map((rec) => {
    const principleNumbers =
      Array.isArray(rec.principleNumbers) && rec.principleNumbers.length > 0
        ? rec.principleNumbers
        : [5]
    const principleNames =
      Array.isArray(rec.principleNames) && rec.principleNames.length > 0
        ? rec.principleNames
        : ['Safer Solvents and Auxiliaries']
    return {
      ...rec,
      principleNumbers,
      principleNames,
      kind: 'chemical_swap',
      alternative: {
        chemical: rec.alternative?.chemical ?? '',
        rationale: rec.alternative?.rationale ?? '',
        yieldImpact: rec.alternative?.yieldImpact ?? '',
        caveats: rec.alternative?.caveats ?? '',
        evidenceBasis: rec.alternative?.evidenceBasis ?? '',
      },
      confidenceLevel: rec.confidenceLevel ?? 'medium',
      severity: rec.severity ?? 'medium',
    }
  })
}

export interface ChemicalSwapRepairResult {
  recommendations: Recommendation[]
  status: 'succeeded' | 'failed'
  addedSwaps: number
  reason?: string
}

/**
 * One validated local LLM repair call. Returns original tips unchanged on failure
 * or when stamped output still has no true chemical_swap.
 */
export async function runChemicalSwapRepair(options: {
  recommendations: Recommendation[]
  hazardousInventory: HazardousInventoryItem[]
  steps: AnalysisStep[]
}): Promise<ChemicalSwapRepairResult> {
  const { recommendations, hazardousInventory, steps } = options
  const model = requireLocalPipelineModel()
  const provider = resolveLocalProvider()
  console.log(
    `[swap-repair] calling local provider=${provider} model=${model} hazardous=${hazardousInventory.length}`,
  )

  try {
    const system = buildSwapRepairSystemPrompt(hazardousInventory)
    const user = [
      'Produce ≥1 true chemical_swap for the hazardous inventory chemicals.',
      'Protocol steps JSON:',
      JSON.stringify(steps, null, 2),
    ].join('\n\n')

    const local = await completeLocalJsonValidated<SwapRepairLlmResult>({
      system,
      user,
      schema: SWAP_REPAIR_SCHEMA as unknown as Record<string, unknown>,
      model,
      label: 'principle-swap-repair',
      numPredict: 12288,
    })

    const rawRecs = Array.isArray(local.data?.recommendations)
      ? local.data.recommendations
      : []
    const normalized = normalizeRepairRecs(rawRecs as Recommendation[])
    const stamped = stampRecommendationKinds(normalized)
    const swaps = stamped.filter((rec) =>
      isChemicalSwapRecommendation(rec) && isInventoryGroundedChemicalSwap(rec, hazardousInventory),
    )

    if (swaps.length === 0) {
      return {
        recommendations,
        status: 'failed',
        addedSwaps: 0,
        reason: 'no_valid_chemical_swap_after_stamp',
      }
    }

    return {
      recommendations: stampRecommendationKinds([...recommendations, ...swaps]),
      status: 'succeeded',
      addedSwaps: swaps.length,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      recommendations,
      status: 'failed',
      addedSwaps: 0,
      reason,
    }
  }
}
