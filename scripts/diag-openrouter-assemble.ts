/**
 * Diagnose OpenRouter empty assemble responses.
 * Usage: npx tsx scripts/diag-openrouter-assemble.ts
 * Loads .env.local; never prints API keys.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

/** Same shape as lib/pipeline.ts ASSEMBLE_SCHEMA (not exported). */
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

const FAKE_STEPS: AnalysisStep[] = [
  {
    stepNumber: 1,
    description: 'Dissolve 1 g salicylic acid in 5 mL acetic anhydride.',
    chemicals: [
      {
        name: 'salicylic acid',
        role: 'reactant',
        quantity: '1 g',
        quantityMl: null,
        quantityKg: 0.001,
      },
      {
        name: 'acetic anhydride',
        role: 'reagent',
        quantity: '5 mL',
        quantityMl: 5,
        quantityKg: null,
      },
    ],
    conditions: {
      temperature: 'room temperature',
      duration: '10 min',
      atmosphere: null,
    },
  },
]

const FAKE_RECS: Recommendation[] = [
  {
    id: 'rec-1',
    principleNumbers: [5],
    principleNames: ['Safer Solvents and Auxiliaries'],
    severity: 'medium',
    stepNumber: 1,
    original: {
      chemical: 'acetic anhydride',
      issue: 'Corrosive acetylating agent',
    },
    alternative: {
      chemical: 'acetic acid',
      rationale: 'Less hazardous acetylating agent for demo purposes.',
      yieldImpact: 'May reduce rate; validate experimentally.',
      caveats: 'Demo-only substitution.',
      evidenceBasis: 'synthetic demo',
    },
    confidenceLevel: 'medium',
    primaryBenefit: 'Safer handling',
  },
]

const USER_MSG =
  'Generate the revised protocol and overall assessment based on the recommendations above.'

type PathKind = 'A_current' | 'B_no_require_parameters' | 'C_json_object'

function buildBody(
  model: string,
  system: string,
  path: PathKind,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model,
    temperature: 0,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: USER_MSG },
    ],
    reasoning: { effort: 'low' },
  }

  if (path === 'A_current') {
    base.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'local_pipeline_result',
        strict: true,
        schema: ASSEMBLE_SCHEMA,
      },
    }
    base.provider = { require_parameters: true, allow_fallbacks: false }
  } else if (path === 'B_no_require_parameters') {
    base.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'local_pipeline_result',
        strict: true,
        schema: ASSEMBLE_SCHEMA,
      },
    }
  } else {
    base.response_format = { type: 'json_object' }
    base.messages = [
      { role: 'system', content: system },
      {
        role: 'user',
        content: USER_MSG + ' Respond with a single JSON object only.',
      },
    ]
  }
  return base
}

function sanitizeErrorBody(text: string): string {
  return text
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 500)
}

async function callPath(
  label: string,
  model: string,
  system: string,
  path: PathKind,
  apiKey: string,
  baseUrl: string,
): Promise<void> {
  const body = buildBody(model, system, path)
  const t0 = Date.now()
  let httpStatus = 0
  let errorBody: string | null = null
  let payload: Record<string, unknown> | null = null

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    httpStatus = response.status
    const rawText = await response.text()
    if (!response.ok) {
      errorBody = sanitizeErrorBody(rawText)
    } else {
      try {
        payload = JSON.parse(rawText) as Record<string, unknown>
      } catch {
        errorBody = sanitizeErrorBody(rawText)
      }
    }
  } catch (err) {
    errorBody = sanitizeErrorBody(err instanceof Error ? err.message : String(err))
  }

  const latencyMs = Date.now() - t0
  const choice = Array.isArray(payload?.choices)
    ? (payload!.choices as Array<Record<string, unknown>>)[0]
    : undefined
  const message = (choice?.message ?? null) as Record<string, unknown> | null
  const content = typeof message?.content === 'string' ? message.content : null

  console.log(
    JSON.stringify(
      {
        label,
        path,
        httpStatus,
        latencyMs,
        modelRequested: model,
        modelReturned: payload?.model ?? null,
        provider: payload?.provider ?? null,
        finish_reason: choice?.finish_reason ?? null,
        native_finish_reason: choice?.native_finish_reason ?? null,
        contentLength: content?.length ?? 0,
        contentPreview: content ? content.slice(0, 200) : null,
        usage: payload?.usage ?? null,
        choicesLength: Array.isArray(payload?.choices)
          ? (payload!.choices as unknown[]).length
          : null,
        hasReasoning: Boolean(
          message?.reasoning || message?.reasoning_details,
        ),
        errorBody,
        payloadError: payload?.error ?? null,
      },
      null,
      2,
    ),
  )
}

async function main(): Promise<void> {
  const root = resolve(__dirname, '..')
  loadEnvLocal(resolve(root, '.env.local'))

  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim()
  if (!apiKey) {
    console.log(JSON.stringify({ error: 'OPENROUTER_API_KEY missing' }))
    process.exitCode = 1
    return
  }
  const baseUrl = (
    process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
  ).replace(/\/$/, '')
  const defaultModel =
    (process.env.GCAI_LOCAL_MODEL || 'qwen/qwen3.8-27b').trim()

  const protocol =
    '1. Dissolve 1 g salicylic acid in 5 mL acetic anhydride.\n2. Stir 10 min.'
  const system = buildAssemblePrompt(protocol, FAKE_STEPS, FAKE_RECS)

  console.log(
    JSON.stringify({
      phase: 'start',
      defaultModel,
      gemmaModel: 'google/gemma-4-31b-it',
      systemChars: system.length,
      schemaKeys: Object.keys(ASSEMBLE_SCHEMA.properties),
      hasKey: true,
      baseUrl,
    }),
  )

  const paths: PathKind[] = [
    'A_current',
    'B_no_require_parameters',
    'C_json_object',
  ]
  for (const path of paths) {
    await callPath(
      `${defaultModel}:${path}`,
      defaultModel,
      system,
      path,
      apiKey,
      baseUrl,
    )
  }

  await callPath(
    'google/gemma-4-31b-it:A_current',
    'google/gemma-4-31b-it',
    system,
    'A_current',
    apiKey,
    baseUrl,
  )
}

void main()
