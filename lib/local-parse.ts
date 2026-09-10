/**
 * Fail-closed Phase 1 parse over local Ollama or OpenRouter local-quality models.
 * When GCAI_LOCAL_PARSE=1 / GCAI_LOCAL_PIPELINE=1, Anthropic must never be used for parse.
 */
import { OLLAMA_PILOT_MODELS } from '@/lib/decomposed-benchmark/ollama-provider'
import { OPENROUTER_LOCAL_QUALITY_MODELS, completeLocalJson } from '@/lib/local-llm'
import { PARSE_SYSTEM_PROMPT } from '@/lib/prompts/parse'
import type { AnalysisStep } from '@/lib/types'

export const LOCAL_PARSE_MODELS = Object.freeze([...OLLAMA_PILOT_MODELS, ...OPENROUTER_LOCAL_QUALITY_MODELS] as const)

export const LOCAL_PARSE_ROLES = [
  'solvent',
  'reagent',
  'reactant',
  'catalyst',
  'product',
  'byproduct',
  'unknown',
] as const

export type LocalParseRole = (typeof LOCAL_PARSE_ROLES)[number]

export interface LocalParseResult {
  protocolTitle: string
  chemistrySubdomain: string
  steps: AnalysisStep[]
  error?: string
  message?: string
  model: string
  repaired: boolean
}

export interface LocalParseEnv {
  [key: string]: string | undefined
  GCAI_LOCAL_PARSE?: string
  GCAI_LOCAL_PIPELINE?: string
  GCAI_LOCAL_PARSE_MODEL?: string
  GCAI_LOCAL_MODEL?: string
}

const LOCAL_PARSE_ADDENDUM = `
LOCAL / FAIL-CLOSED RULES (override soft guidance above when they conflict):
- Each steps[].description MUST be an exact contiguous substring of the protocol text. Copy verbatim; never paraphrase.
- Each chemicals[].name MUST appear as a substring of the protocol text.
- Each chemicals[].quantity MUST be "" or an exact contiguous substring of the protocol text.
- chemicals[].role MUST be one of: solvent, reagent, reactant, catalyst, product, byproduct, unknown.
  Map workup/drying_agent/other (and anything else) to "unknown".
- conditions keys are optional. When present, each value MUST be an exact contiguous substring of THAT SAME step's description.
  Never copy temperature/duration/atmosphere from a different step. Prefer omitting a key over inventing values or writing the string "null".
- Return ONLY the JSON object. No markdown fences.
`

/** JSON Schema passed to Ollama \`format\` for structured output. */
export const LOCAL_PARSE_SCHEMA = {
  type: 'object',
  properties: {
    protocolTitle: { type: 'string' },
    chemistrySubdomain: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stepNumber: { type: 'integer' },
          description: { type: 'string' },
          chemicals: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                role: { type: 'string', enum: [...LOCAL_PARSE_ROLES] },
                quantity: { type: 'string' },
                quantityMl: { type: ['number', 'null'] },
                quantityKg: { type: ['number', 'null'] },
              },
              required: ['name', 'role', 'quantity'],
              additionalProperties: false,
            },
          },
          conditions: {
            type: 'object',
            properties: {
              temperature: { type: 'string' },
              duration: { type: 'string' },
              atmosphere: { type: 'string' },
              pressure: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        required: ['stepNumber', 'description', 'chemicals', 'conditions'],
        additionalProperties: false,
      },
    },
    error: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['protocolTitle', 'chemistrySubdomain', 'steps'],
  additionalProperties: false,
} as const

export function isLocalParseEnabled(env: LocalParseEnv = process.env): boolean {
  return env.GCAI_LOCAL_PARSE === '1' || env.GCAI_LOCAL_PIPELINE === '1'
}

export function requireLocalParseModel(env: LocalParseEnv = process.env): string {
  const model = (env.GCAI_LOCAL_MODEL || env.GCAI_LOCAL_PARSE_MODEL || '').trim()
  if (!model || !(LOCAL_PARSE_MODELS as readonly string[]).includes(model)) {
    throw new Error('local_parse_configuration_invalid')
  }
  return model
}

export function mapParseRole(role: unknown): LocalParseRole {
  if (typeof role !== 'string') return 'unknown'
  const normalized = role.trim().toLowerCase()
  if ((LOCAL_PARSE_ROLES as readonly string[]).includes(normalized)) {
    return normalized as LocalParseRole
  }
  return 'unknown'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}


/** Treat common LLM null-sentinels as absent condition values. */
export function isAbsentConditionValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return true
  return /^(null|none|n\/a|na|undefined|-)$/i.test(trimmed)
}

/** Structural + source-anchoring validation for chemistry local-helper compatibility. */
export function validateLocalParseResult(
  protocolText: string,
  value: unknown,
): { ok: true; result: Omit<LocalParseResult, 'model' | 'repaired'> } | { ok: false; reason: string } {
  if (!isPlainObject(value)) return { ok: false, reason: 'not_object' }

  if (value.error === 'not_chemistry') {
    return {
      ok: true,
      result: {
        protocolTitle: '',
        chemistrySubdomain: '',
        steps: [],
        error: 'not_chemistry',
        message: typeof value.message === 'string' ? value.message : 'Not a chemistry protocol',
      },
    }
  }

  if (typeof value.protocolTitle !== 'string' || !value.protocolTitle.trim()) {
    return { ok: false, reason: 'title' }
  }
  if (typeof value.chemistrySubdomain !== 'string' || !value.chemistrySubdomain.trim()) {
    return { ok: false, reason: 'subdomain' }
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > 1000) {
    return { ok: false, reason: 'steps' }
  }

  const steps: AnalysisStep[] = []
  let cursor = 0
  for (let i = 0; i < value.steps.length; i++) {
    const raw = value.steps[i]
    if (!isPlainObject(raw)) return { ok: false, reason: `step_${i}_type` }
    if (typeof raw.stepNumber !== 'number' || raw.stepNumber !== i + 1) {
      return { ok: false, reason: `step_${i}_number` }
    }
    if (typeof raw.description !== 'string' || !raw.description.trim()) {
      return { ok: false, reason: `step_${i}_description` }
    }
    const start = protocolText.indexOf(raw.description, cursor)
    if (start < 0) return { ok: false, reason: `step_${i}_not_anchored` }
    cursor = start + raw.description.length

    if (!Array.isArray(raw.chemicals)) return { ok: false, reason: `step_${i}_chemicals` }
    if (!isPlainObject(raw.conditions)) return { ok: false, reason: `step_${i}_conditions` }

    const chemicals = []
    for (const chem of raw.chemicals) {
      if (!isPlainObject(chem)) return { ok: false, reason: `step_${i}_chem_type` }
      if (typeof chem.name !== 'string' || !chem.name.trim() || !raw.description.includes(chem.name)) {
        return { ok: false, reason: `step_${i}_chem_name` }
      }
      const quantity = typeof chem.quantity === 'string' ? chem.quantity : ''
      if (quantity && !protocolText.includes(quantity)) {
        return { ok: false, reason: `step_${i}_chem_quantity` }
      }
      const role = mapParseRole(chem.role)
      chemicals.push({
        name: chem.name,
        role,
        quantity,
        ...(typeof chem.quantityMl === 'number' ? { quantityMl: chem.quantityMl } : {}),
        ...(typeof chem.quantityKg === 'number' ? { quantityKg: chem.quantityKg } : {}),
      })
    }

    const conditions: Record<string, string> = {}
    for (const key of ['temperature', 'duration', 'atmosphere', 'pressure'] as const) {
      const v = raw.conditions[key]
      // Schema often forces string fields; models emit "null" or copy conditions across steps.
      // Drop absent/unanchored values instead of failing the whole parse (descriptions/chems stay strict).
      if (isAbsentConditionValue(v)) continue
      if (typeof v !== 'string') continue
      if (!raw.description.includes(v)) continue
      conditions[key] = v
    }

    steps.push({
      stepNumber: raw.stepNumber,
      description: raw.description,
      chemicals: chemicals.map((c) => ({
        name: c.name,
        role: c.role,
        quantity: c.quantity,
        quantityMl: typeof c.quantityMl === 'number' ? c.quantityMl : null,
        quantityKg: typeof c.quantityKg === 'number' ? c.quantityKg : null,
      })),
      conditions: {
        temperature: conditions.temperature ?? null,
        duration: conditions.duration ?? null,
        atmosphere: conditions.atmosphere ?? null,
      },
    })
  }

  return {
    ok: true,
    result: {
      protocolTitle: value.protocolTitle.trim(),
      chemistrySubdomain: value.chemistrySubdomain.trim(),
      steps,
    },
  }
}

/**
 * Adapt parsed steps into the frozen local-helper runner contract shape.
 * Always safe to call; maps roles and keeps source-anchored fields.
 */
export function adaptStepsForLocalHelpers(protocolText: string, steps: AnalysisStep[]) {
  return steps.map((step, index) => ({
    stepNumber: index + 1,
    description: step.description,
    chemicals: step.chemicals.map((c) => ({
      name: c.name,
      role: mapParseRole(c.role),
      quantity: typeof c.quantity === 'string' ? c.quantity : '',
    })),
    conditions: Object.fromEntries(
      Object.entries(step.conditions || {}).filter(
        ([key, value]) =>
          ['temperature', 'duration', 'atmosphere', 'pressure'].includes(key)
          && typeof value === 'string'
          && value
          && step.description.includes(value),
      ),
    ),
  })).filter((step) => protocolText.includes(step.description))
}

export function flattenChemicalsForScore(steps: ReturnType<typeof adaptStepsForLocalHelpers>) {
  const seen = new Map<string, { name: string; role: string; quantity: string }>()
  for (const step of steps) {
    for (const chem of step.chemicals) {
      const key = `${chem.name}|${chem.role}|${chem.quantity}`
      if (!seen.has(key)) seen.set(key, chem)
    }
  }
  return [...seen.values()]
}

async function localParseOnce(options: {
  protocolText: string
  model: string
  system: string
  fetchImpl: typeof fetch
  timeoutMs: number
}): Promise<unknown> {
  return completeLocalJson({
    system: options.system,
    user: options.protocolText,
    schema: LOCAL_PARSE_SCHEMA as unknown as Record<string, unknown>,
    model: options.model,
    label: 'parse',
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    numPredict: 8192,
  })
}

export async function parseProtocolLocal(options: {
  protocolText: string
  model?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  env?: LocalParseEnv
}): Promise<LocalParseResult> {
  const text = options.protocolText
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 1_048_576) {
    throw new Error('local_parse_input_invalid')
  }
  const model = options.model ?? requireLocalParseModel(options.env ?? process.env)
  if (!(LOCAL_PARSE_MODELS as readonly string[]).includes(model)) {
    throw new Error('local_parse_configuration_invalid')
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 180_000
  const system = `${PARSE_SYSTEM_PROMPT}\n\n${LOCAL_PARSE_ADDENDUM}`

  let parsed = await localParseOnce({ protocolText: text, model, system, fetchImpl, timeoutMs })
  let validated = validateLocalParseResult(text, parsed)
  let repaired = false
  if (!validated.ok) {
    repaired = true
    console.warn(
      `[local-parse] first pass failed validation (${validated.reason}); repairing once`,
    )
    const repairSystem = `${system}\n\nPrevious JSON failed validation (${validated.reason}). `
      + 'Copy each step.description verbatim from the protocol. '
      + 'Use only roles solvent|reagent|reactant|catalyst|product|byproduct|unknown. '
      + 'Omit condition keys unless the exact substring appears in that same step description; never write the string "null".'
    parsed = await localParseOnce({
      protocolText: text,
      model,
      system: repairSystem,
      fetchImpl,
      timeoutMs,
    })
    validated = validateLocalParseResult(text, parsed)
    if (!validated.ok) throw new Error(`local_parse_invalid:${validated.reason}`)
  }

  return { ...validated.result, model, repaired }
}
