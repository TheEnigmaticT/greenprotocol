/**
 * Full end-to-end analyzeProtocol smoke (local OpenRouter + chemistry scoring).
 * Usage: npx tsx scripts/smoke-full-analyze-local.ts [protocolPath]
 * Optional: PROTOCOL_PATH=/path/to/protocol.txt OUT_SUMMARY=/tmp/summary.json
 * Loads .env.local; never prints API keys.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { analyzeProtocol } from '../lib/pipeline'
import type { AnalysisResult, ProgressEvent, Recommendation } from '../lib/types'

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

const DEFAULT_PROTOCOL = `Aspirin synthesis (demo)

1. Add 2.0 g salicylic acid to a 50 mL flask.
2. Add 5 mL acetic anhydride and 3 drops of concentrated phosphoric acid as catalyst.
3. Heat the mixture at 70 C for 15 minutes with stirring.
4. Cool to room temperature, then add 20 mL cold water to crystallize the product.
5. Filter the solid aspirin and wash with cold water. Dry the product.
`

function loadProtocolText(): { text: string; source: string } {
  const fromArg = process.argv[2]
  const fromEnv = process.env.PROTOCOL_PATH
  const path = fromArg || fromEnv
  if (path) {
    const abs = resolve(path)
    if (!existsSync(abs)) {
      throw new Error(`PROTOCOL_PATH not found: ${abs}`)
    }
    return { text: readFileSync(abs, 'utf8'), source: abs }
  }
  return { text: DEFAULT_PROTOCOL, source: 'builtin:aspirin-demo' }
}

function redactSecrets(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'string') {
    if (/sk-|api[_-]?key|Bearer\s+/i.test(value) && value.length > 20) return '[REDACTED]'
    return value
  }
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/key|token|secret|password|authorization/i.test(k)) {
        out[k] = '[REDACTED]'
      } else {
        out[k] = redactSecrets(v)
      }
    }
    return out
  }
  return value
}

function countByKind(recs: Recommendation[]): Record<string, number> {
  const counts: Record<string, number> = {
    chemical_swap: 0,
    process_change: 0,
    analytical: 0,
    unspecified: 0,
  }
  for (const r of recs) {
    const kind = r.kind ?? 'chemical_swap'
    if (kind in counts) counts[kind]++
    else counts.unspecified++
  }
  return counts
}

function countByConfidence(recs: Recommendation[]): Record<string, number> {
  const counts: Record<string, number> = { high: 0, medium: 0, low: 0 }
  for (const r of recs) {
    const c = r.confidenceLevel || 'low'
    counts[c] = (counts[c] ?? 0) + 1
  }
  return counts
}

function logProgress(event: ProgressEvent): void {
  if (event.type === 'phase') {
    console.log(`[progress] phase=${event.phase} ${event.message}`)
  } else if (event.type === 'principle') {
    console.log(
      `[progress] principle #${event.number} ${event.name} status=${event.status}` +
        (event.recommendations != null ? ` recs=${event.recommendations}` : '')
    )
  } else if (event.type === 'score') {
    console.log(
      `[progress] score P${event.principle} ${event.name}=${event.score} (${event.confidence})`
    )
  } else if (event.type === 'error') {
    console.log(`[progress] error: ${event.error}${event.code ? ` code=${event.code}` : ''}`)
  } else if (event.type === 'result') {
    console.log('[progress] result event received')
  }
}

async function main(): Promise<void> {
  const root = resolve(__dirname, '..')
  loadEnvLocal(resolve(root, '.env.local'))

  console.log('=== smoke-full-analyze-local ===')
  console.log('GCAI_LOCAL_PIPELINE=', process.env.GCAI_LOCAL_PIPELINE)
  console.log('GCAI_LOCAL_PROVIDER=', process.env.GCAI_LOCAL_PROVIDER)
  console.log('GCAI_LOCAL_MODEL=', process.env.GCAI_LOCAL_MODEL)
  console.log('GCAI_LOCAL_REASONING_EFFORT=', process.env.GCAI_LOCAL_REASONING_EFFORT)
  console.log('CHEMISTRY_SERVICE_URL=', process.env.CHEMISTRY_SERVICE_URL)
  console.log('GCAI_LOCAL_EVIDENCE_INDEX=', process.env.GCAI_LOCAL_EVIDENCE_INDEX)
  console.log('OPENROUTER_API_KEY present=', Boolean(process.env.OPENROUTER_API_KEY))
  console.log('CHEMISTRY_SERVICE_TOKEN present=', Boolean(process.env.CHEMISTRY_SERVICE_TOKEN))
  console.log('ANTHROPIC_API_KEY will NOT be used by this smoke (local pipeline).')

  const loaded = loadProtocolText()
  const PROTOCOL = loaded.text
  const outSummary =
    process.env.OUT_SUMMARY || '/tmp/gcai-full-analyze-summary.json'
  console.log('protocolSource=', loaded.source)
  console.log('protocolBytes=', Buffer.byteLength(PROTOCOL, 'utf8'))

  const t0 = Date.now()
  let result: AnalysisResult | null = null
  let thrown: string | null = null

  try {
    result = await analyzeProtocol(PROTOCOL, logProgress)
  } catch (err) {
    thrown = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.error('analyzeProtocol THREW:', thrown)
  }

  const wallMs = Date.now() - t0
  const wallSec = Math.round(wallMs / 1000)

  if (!result) {
    const failSummary = {
      ok: false,
      thrown,
      wallTimeMs: wallMs,
      wallTimeSec: wallSec,
    }
    writeFileSync(outSummary, JSON.stringify(failSummary, null, 2))
    console.log(JSON.stringify(failSummary, null, 2))
    process.exit(1)
  }

  const recs = result.recommendations ?? []
  const recommendationPreviews = recs.map((r) => ({
    kind: r.kind ?? 'chemical_swap',
    originalChemical: r.original?.chemical ?? '',
    alternativeChemical: r.alternative?.chemical ?? '',
    confidenceLevel: r.confidenceLevel ?? null,
    primaryBenefit: r.primaryBenefit ?? null,
  }))
  console.log('\n=== RECOMMENDATION PREVIEWS ===')
  for (const [i, p] of recommendationPreviews.entries()) {
    console.log(
      `#${i + 1} [${p.kind}] ${p.originalChemical} → ${p.alternativeChemical}` +
        ` | confidence=${p.confidenceLevel ?? 'n/a'}` +
        ` | benefit=${p.primaryBenefit ?? 'n/a'}`
    )
  }
  const kindCounts = countByKind(recs)
  const confidenceCounts = countByConfidence(recs)
  const revisedLen = (result.revisedProtocol ?? '').length
  const assembleFailed =
    revisedLen === 0 &&
    recs.some((r) => (r.kind ?? 'chemical_swap') === 'chemical_swap')

  const ds = result.deterministicScores
  const chemistryStatus = result.chemistryDataStatus

  const summary = {
    ok: true,
    thrown: null as string | null,
    wallTimeMs: wallMs,
    wallTimeSec: wallSec,
    protocolSource: loaded.source,
    protocolTitle: result.protocolTitle,
    chemistrySubdomain: result.chemistrySubdomain,
    stepCount: result.steps?.length ?? 0,
    grade: ds?.grade ?? null,
    totalScore: ds?.total_score ?? null,
    maxPossible: ds?.max_possible ?? null,
    deterministicScoresPresent: Boolean(ds),
    principleScoreCount: ds?.scores?.length ?? 0,
    chemistryDataStatus: chemistryStatus
      ? {
          pending: chemistryStatus.pending,
          deterministicScoringAvailable: chemistryStatus.deterministicScoringAvailable,
          unresolvedChemicals: chemistryStatus.unresolvedChemicals,
          indefiniteChemicals: chemistryStatus.indefiniteChemicals ?? [],
          message: chemistryStatus.message,
        }
      : null,
    chemistrySkipReason:
      !ds && chemistryStatus?.message
        ? chemistryStatus.message
        : !ds
          ? 'deterministicScores missing (no chemistryDataStatus message)'
          : null,
    recommendationCount: recs.length,
    recommendationsByKind: kindCounts,
    recommendationPreviews,
    confidenceBreakdown: confidenceCounts,
    revisedProtocolLength: revisedLen,
    assembleFailedNote: assembleFailed
      ? 'revisedProtocol empty while chemical_swap recommendations exist — assemble likely failed (graceful degradation)'
      : revisedLen === 0
        ? 'revisedProtocol empty (no chemical_swap recs or empty string returned)'
        : null,
    overallAssessment: result.overallAssessment
      ? {
          greenPrinciplesViolated: result.overallAssessment.greenPrinciplesViolated,
          mostImpactfulChange: result.overallAssessment.mostImpactfulChange,
          experimentalValidationNeeded:
            result.overallAssessment.experimentalValidationNeeded,
        }
      : null,
    reevaluationStats: result.reevaluationStats ?? null,
    // Compact deterministic score list for the JSON artifact
    principleScores: ds?.scores?.map((s) => ({
      principle_number: s.principle_number,
      principle_name: s.principle_name,
      score: s.score,
      confidence: s.confidence,
    })),
  }

  const safeSummary = redactSecrets(summary)
  writeFileSync(outSummary, JSON.stringify(safeSummary, null, 2))

  console.log('\n=== SUMMARY ===')
  console.log('protocolTitle:', summary.protocolTitle)
  console.log('stepCount:', summary.stepCount)
  console.log('grade:', summary.grade)
  console.log('totalScore:', summary.totalScore, '/', summary.maxPossible)
  console.log('deterministicScoresPresent:', summary.deterministicScoresPresent)
  if (summary.chemistrySkipReason) {
    console.log('chemistrySkipReason:', summary.chemistrySkipReason)
  }
  if (summary.chemistryDataStatus) {
    console.log(
      'chemistryDataStatus:',
      summary.chemistryDataStatus.deterministicScoringAvailable
        ? 'scoring available'
        : 'scoring unavailable',
      '|',
      summary.chemistryDataStatus.message
    )
  }
  console.log('recommendations:', summary.recommendationCount)
  console.log('by kind:', JSON.stringify(summary.recommendationsByKind))
  console.log('recommendationPreviews:', JSON.stringify(summary.recommendationPreviews, null, 2))
  console.log('confidence:', JSON.stringify(summary.confidenceBreakdown))
  console.log('revisedProtocol length:', summary.revisedProtocolLength)
  if (summary.assembleFailedNote) console.log('assemble note:', summary.assembleFailedNote)
  console.log('wall time:', summary.wallTimeSec, 's')
  console.log('wrote', outSummary)
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
