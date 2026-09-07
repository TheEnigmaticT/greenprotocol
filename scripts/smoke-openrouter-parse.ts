/**
 * Smoke-test OpenRouter local parse path (no Anthropic).
 * Usage from worktree: npx tsx scripts/smoke-openrouter-parse.ts
 * Loads .env.local itself; never prints API keys.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseProtocolLocal } from '../lib/local-parse'
import { resolveLocalProvider } from '../lib/local-llm'

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

const PROTOCOL = `Aspirin synthesis (demo)

1. Add 2.0 g salicylic acid to a 50 mL flask.
2. Add 5 mL acetic anhydride and 3 drops of concentrated phosphoric acid as catalyst.
3. Heat the mixture at 70 C for 15 minutes with stirring.
4. Cool to room temperature, then add 20 mL cold water to crystallize the product.
5. Filter the solid aspirin and wash with cold water. Dry the product.
`

async function main(): Promise<void> {
  const root = resolve(__dirname, '..')
  loadEnvLocal(resolve(root, '.env.local'))

  const anthropicHits: string[] = []
  const openrouterHits: string[] = []
  const openrouterDiagnostics: Array<Record<string, unknown>> = []
  const realFetch = globalThis.fetch.bind(globalThis)
  const trackedFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (/anthropic\.com/i.test(url)) anthropicHits.push(url)
    if (/openrouter\.ai/i.test(url)) openrouterHits.push(url)
    const response = await realFetch(input, init)
    if (/openrouter\.ai/i.test(url)) {
      const clone = response.clone()
      try {
        const payload = await clone.json() as {
          model?: string
          provider?: string
          error?: unknown
          choices?: Array<{
            finish_reason?: string
            native_finish_reason?: string
            message?: {
              content?: string | null
              reasoning?: string
              reasoning_details?: unknown
            }
          }>
          usage?: unknown
        }
        const choice = payload.choices?.[0]
        const content = choice?.message?.content
        openrouterDiagnostics.push({
          httpStatus: response.status,
          model: payload.model ?? null,
          provider: payload.provider ?? null,
          finish_reason: choice?.finish_reason ?? null,
          native_finish_reason: choice?.native_finish_reason ?? null,
          contentType: typeof content,
          contentLen: typeof content === 'string' ? content.length : null,
          contentEmpty: typeof content !== 'string' || !content.trim(),
          hasReasoning: Boolean(choice?.message?.reasoning || choice?.message?.reasoning_details),
          usage: payload.usage ?? null,
          error: payload.error ?? null,
          contentPreview:
            typeof content === 'string' && content.trim()
              ? content.slice(0, 160)
              : null,
        })
      } catch (err) {
        openrouterDiagnostics.push({
          httpStatus: response.status,
          parseError: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return response
  }

  const provider = resolveLocalProvider(process.env)
  const model = (process.env.GCAI_LOCAL_MODEL || '').trim()
  console.log(
    JSON.stringify({
      phase: 'start',
      provider,
      model,
      localPipeline: process.env.GCAI_LOCAL_PIPELINE,
      hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    }),
  )

  const t0 = Date.now()
  try {
    const result = await parseProtocolLocal({
      protocolText: PROTOCOL,
      fetchImpl: trackedFetch,
      timeoutMs: 180_000,
    })
    const latencyMs = Date.now() - t0
    console.log(
      JSON.stringify(
        {
          success: true,
          latencyMs,
          protocolTitle: result.protocolTitle,
          chemistrySubdomain: result.chemistrySubdomain,
          stepCount: result.steps.length,
          repaired: result.repaired,
          model: result.model,
          firstStepDescription: result.steps[0]?.description ?? null,
          anthropicInvolved: anthropicHits.length > 0,
          anthropicHitCount: anthropicHits.length,
          openrouterHitCount: openrouterHits.length,
          openrouterDiagnostics,
          provider,
        },
        null,
        2,
      ),
    )
  } catch (err) {
    const latencyMs = Date.now() - t0
    console.log(
      JSON.stringify(
        {
          success: false,
          latencyMs,
          error: err instanceof Error ? err.message : String(err),
          anthropicInvolved: anthropicHits.length > 0,
          anthropicHitCount: anthropicHits.length,
          openrouterHitCount: openrouterHits.length,
          openrouterDiagnostics,
          provider,
          model,
        },
        null,
        2,
      ),
    )
    process.exitCode = 1
  }
}

void main()
