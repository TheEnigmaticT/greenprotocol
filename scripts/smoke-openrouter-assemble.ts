/**
 * Smoke-test OpenRouter assemble via completeLocalJson (hollow-retry path).
 * Usage: npx tsx scripts/smoke-openrouter-assemble.ts
 * Loads .env.local; never prints API keys.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { completeLocalJson, resolveLocalProvider } from '../lib/local-llm'
import { buildAssemblePrompt } from '../lib/prompts/assemble'
import type { AnalysisStep, Recommendation } from '../lib/types'

function loadEnvLocal(path: string): void {
  const text = readFileSync(path, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

/** Mirrors lib/pipeline.ts ASSEMBLE_SCHEMA (not exported). */
const ASSEMBLE_SCHEMA = {
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
      required: [
        'greenPrinciplesViolated',
        'mostImpactfulChange',
        'experimentalValidationNeeded',
        'disclaimer',
      ],
      additionalProperties: false,
    },
  },
  required: ['revisedProtocol', 'overallAssessment'],
  additionalProperties: false,
} as const

const PROTOCOL = `Aspirin synthesis (demo)

1. Add 2.0 g salicylic acid to a 50 mL flask.
2. Add 5 mL acetic anhydride and 3 drops of concentrated phosphoric acid as catalyst.
3. Heat the mixture at 70 C for 15 minutes with stirring.
4. Cool to room temperature, then add 20 mL cold water to crystallize the product.
5. Filter the solid aspirin and wash with cold water. Dry the product.
`

const FAKE_STEPS: AnalysisStep[] = [
  {
    stepNumber: 1,
    description: 'Add 2.0 g salicylic acid to a 50 mL flask.',
    chemicals: [
      {
        name: 'salicylic acid',
        role: 'reactant',
        quantity: '2.0 g',
        quantityMl: null,
        quantityKg: 0.002,
      },
    ],
    conditions: { temperature: null, duration: null, atmosphere: null },
  },
  {
    stepNumber: 2,
    description:
      'Add 5 mL acetic anhydride and 3 drops of concentrated phosphoric acid as catalyst.',
    chemicals: [
      {
        name: 'acetic anhydride',
        role: 'reagent',
        quantity: '5 mL',
        quantityMl: 5,
        quantityKg: null,
      },
      {
        name: 'phosphoric acid',
        role: 'catalyst',
        quantity: '3 drops',
        quantityMl: null,
        quantityKg: null,
      },
    ],
    conditions: { temperature: null, duration: null, atmosphere: null },
  },
  {
    stepNumber: 3,
    description: 'Heat the mixture at 70 C for 15 minutes with stirring.',
    chemicals: [],
    conditions: {
      temperature: '70 C',
      duration: '15 minutes',
      atmosphere: null,
    },
  },
  {
    stepNumber: 4,
    description:
      'Cool to room temperature, then add 20 mL cold water to crystallize the product.',
    chemicals: [
      {
        name: 'water',
        role: 'solvent',
        quantity: '20 mL',
        quantityMl: 20,
        quantityKg: null,
      },
    ],
    conditions: {
      temperature: 'room temperature',
      duration: null,
      atmosphere: null,
    },
  },
  {
    stepNumber: 5,
    description:
      'Filter the solid aspirin and wash with cold water. Dry the product.',
    chemicals: [
      {
        name: 'aspirin',
        role: 'product',
        quantity: '',
        quantityMl: null,
        quantityKg: null,
      },
    ],
    conditions: { temperature: null, duration: null, atmosphere: null },
  },
]

function padRationale(seed: string, targetChars: number): string {
  const pad =
    ' Supporting literature notes emphasize safer handling, reduced corrosivity, '
    + 'and the need for experimental yield validation under teaching-lab constraints. '
  let out = seed
  while (out.length < targetChars) out += pad
  return out.slice(0, targetChars)
}

/** ~2KB recommendations payload (4 recs) for assemble prompt size. */
const FAKE_RECS: Recommendation[] = [
  {
    id: 'rec-1',
    stepNumber: 2,
    principleNumbers: [5],
    principleNames: ['Safer Solvents and Auxiliaries'],
    severity: 'high',
    original: {
      chemical: 'acetic anhydride',
      issue:
        'Corrosive acetylating agent with inhalation hazard in open teaching labs.',
    },
    alternative: {
      chemical: 'acetic acid / acetyl chloride (demo-safer path)',
      rationale: padRationale(
        'Replace bulk acetic anhydride with a milder acetylation protocol where feasible.',
        180,
      ),
      yieldImpact: 'May reduce rate; expect 5–15% yield drop without optimization.',
      caveats: 'Demo-only substitution; validate stoichiometry and workup.',
      evidenceBasis: 'synthetic demo + solvent-hazard heuristics',
    },
    confidenceLevel: 'medium',
    primaryBenefit: 'Safer handling of acylating agent',
  },
  {
    id: 'rec-2',
    stepNumber: 2,
    principleNumbers: [3, 9],
    principleNames: [
      'Less Hazardous Chemical Syntheses',
      'Catalysis',
    ],
    severity: 'medium',
    original: {
      chemical: 'phosphoric acid',
      issue: 'Strong mineral acid catalyst; splash and corrosion risk.',
    },
    alternative: {
      chemical: 'solid acid resin (Amberlyst-15 style)',
      rationale: padRationale(
        'Heterogeneous acid catalysis reduces liquid acid waste and simplifies quench.',
        180,
      ),
      yieldImpact: 'Comparable conversion if residence time is extended slightly.',
      caveats: 'Resin swelling and filtration steps must be planned.',
      evidenceBasis: 'catalysis best-practice demo',
    },
    confidenceLevel: 'medium',
    primaryBenefit: 'Easier catalyst recovery / less corrosive liquid waste',
  },
  {
    id: 'rec-3',
    stepNumber: 3,
    principleNumbers: [6],
    principleNames: ['Design for Energy Efficiency'],
    severity: 'low',
    original: {
      chemical: 'heat to 70 C',
      issue: 'Elevated temperature for 15 min increases energy use.',
    },
    alternative: {
      chemical: 'milder 50–60 C with longer stir',
      rationale: padRationale(
        'Lower bath temperature with modestly longer time often preserves conversion.',
        180,
      ),
      yieldImpact: 'Neutral if time compensated; monitor TLC/IR.',
      caveats: 'Do not under-heat if moisture present.',
      evidenceBasis: 'energy-efficiency heuristic',
    },
    confidenceLevel: 'low',
    primaryBenefit: 'Reduced energy intensity',
  },
  {
    id: 'rec-4',
    stepNumber: 4,
    principleNumbers: [5, 1],
    principleNames: [
      'Safer Solvents and Auxiliaries',
      'Prevention',
    ],
    severity: 'medium',
    original: {
      chemical: 'cold water crystallization flood',
      issue: 'Large aqueous quench volume creates dilute organic-contaminated waste.',
    },
    alternative: {
      chemical: 'minimal cold water + ice with staged addition',
      rationale: padRationale(
        'Reduce quench volume and recover mother liquor where practical to cut waste mass.',
        180,
      ),
      yieldImpact: 'Slightly lower recovery if crystallization undersaturated.',
      caveats: 'Keep temperature control to avoid oiling out.',
      evidenceBasis: 'waste-prevention demo',
    },
    confidenceLevel: 'medium',
    primaryBenefit: 'Lower aqueous waste volume',
  },
]

type AssembleSmokeResult = {
  revisedProtocol: string
  overallAssessment: {
    greenPrinciplesViolated: number[]
    mostImpactfulChange: string
    experimentalValidationNeeded: boolean
    disclaimer: string
  }
}

async function main(): Promise<void> {
  const root = resolve(__dirname, '..')
  loadEnvLocal(resolve(root, '.env.local'))

  const provider = resolveLocalProvider(process.env)
  const model = (process.env.GCAI_LOCAL_MODEL || '').trim()
  const system = buildAssemblePrompt(PROTOCOL, FAKE_STEPS, FAKE_RECS)
  const recsJsonChars = JSON.stringify(FAKE_RECS).length

  console.log(
    JSON.stringify({
      phase: 'start',
      provider,
      model,
      localPipeline: process.env.GCAI_LOCAL_PIPELINE,
      hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      systemChars: system.length,
      recsJsonChars,
      recCount: FAKE_RECS.length,
    }),
  )

  const t0 = Date.now()
  try {
    const result = await completeLocalJson<AssembleSmokeResult>({
      system,
      user:
        'Generate the revised protocol and overall assessment based on the recommendations above.',
      schema: ASSEMBLE_SCHEMA as unknown as Record<string, unknown>,
      model,
      label: 'smoke-assemble',
      numPredict: 16384,
      timeoutMs: 180_000,
    })
    const latencyMs = Date.now() - t0
    const ok =
      typeof result?.revisedProtocol === 'string'
      && result.revisedProtocol.trim().length > 0
      && result.overallAssessment
      && typeof result.overallAssessment.mostImpactfulChange === 'string'
    console.log(
      JSON.stringify({
        phase: 'ok',
        latencyMs,
        ok,
        revisedProtocolChars: result.revisedProtocol?.length ?? 0,
        revisedProtocolPreview: (result.revisedProtocol || '').slice(0, 240),
        overallAssessment: result.overallAssessment,
      }),
    )
    if (!ok) process.exitCode = 1
  } catch (err) {
    const latencyMs = Date.now() - t0
    console.log(
      JSON.stringify({
        phase: 'error',
        latencyMs,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    process.exitCode = 1
  }
}

void main()
