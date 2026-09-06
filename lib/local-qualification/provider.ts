import { readFileSync } from 'node:fs'
import { CAP_MICRO_USD, QualificationError, createLedger, createTestLedger, digest, fail, integer, ownMission, type Mission, type Reservation, type Telemetry } from './manifests'

// Exact approval, not family matching. Qwen IDs deliberately absent pending discovery.
export const APPROVED_MODELS = Object.freeze(['google/gemma-4-31b-it'] as const)
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const MAX_BYTES = 4_194_304
// Public catalog verified 2026-09-05; no family aliases and no guessed Qwen IDs.
export const MODEL_CONTEXT = Object.freeze({ 'google/gemma-4-31b-it': 262144 })
export const MODEL_COMPLETION_LIMIT = Object.freeze({ 'google/gemma-4-31b-it': 16384 })
interface Approval { approved: boolean; tokenHash: string | null; inputHashes: Readonly<Record<string, string>> | null }
// Only independent reviews may replace this release manifest. No runtime override.
export const LIVE_APPROVAL: Readonly<{ approved: boolean }> = Object.freeze({ approved: false })
export const REVIEW_INPUTS = Object.freeze([
  'lib/local-qualification/provider.ts', 'lib/local-qualification/manifests.ts',
  'lib/local-qualification/stages.ts', 'lib/local-qualification/discovery.ts',
  'lib/local-qualification/analysis.ts', 'lib/local-qualification/stage-store.ts',
  'lib/local-qualification/extraction-jobs.ts', 'lib/local-qualification/principle-jobs.ts',
  'lib/local-qualification/source.ts', 'lib/local-qualification/graph.ts',
  'lib/local-qualification/coverage-audit.ts', 'lib/local-qualification/claim-audit.ts',
  'lib/local-qualification/evidence.ts', 'lib/local-qualification/decisions.ts',
  'lib/local-qualification/principles.ts', 'lib/local-qualification/corpus.ts',
  'lib/local-qualification/reporting.ts', 'lib/local-qualification/patch.ts',
  'docs/benchmarks/live-provider-spec-rereview.md',
  'docs/benchmarks/live-provider-spec-review.md', 'docs/benchmarks/live-provider-quality-review.md',
  'docs/benchmarks/stages-spec-review.md', 'docs/benchmarks/stages-quality-review.md',
  'docs/benchmarks/discovery-spec-review.md', 'docs/benchmarks/discovery-quality-review.md',
  'docs/benchmarks/reporting-spec-review.md', 'docs/benchmarks/reporting-quality-review.md',
])
export function verifyApprovalManifest(manifest: Approval, token: string | undefined, readInput: (path: string) => string | Buffer) {
  if (!manifest || manifest.approved !== true || !manifest.tokenHash || !manifest.inputHashes || typeof token !== 'string' || digest(token) !== manifest.tokenHash) fail('LIVE_NOT_APPROVED')
  for (const path of REVIEW_INPUTS) {
    const expected = manifest.inputHashes[path]
    if (!expected || !/^[a-f0-9]{64}$/.test(expected)) fail('APPROVAL_STALE')
    let actual: string
    try { actual = digest(readInput(path)) } catch { return fail('APPROVAL_STALE') }
    if (actual !== expected) fail('APPROVAL_STALE')
  }
}
function checkApproval(token: string | undefined) {
  if (!LIVE_APPROVAL.approved) fail('LIVE_NOT_APPROVED')
  let manifest: Approval
  try { manifest = JSON.parse(readFileSync(new URL('../../docs/benchmarks/live-provider-approval.json', import.meta.url), 'utf8')) } catch { return fail('LIVE_NOT_APPROVED') }
  verifyApprovalManifest(manifest, token, path => readFileSync(new URL(`../../${path}`, import.meta.url)))
}
const PROVIDERS: Readonly<Record<string, string>> = Object.freeze({ 'deepinfra/turbo': 'DeepInfra', 'coreweave/fp4': 'CoreWeave' })
export interface QualificationRequest {
  tupleHash: string
  attempt: number
  model: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  maxCompletionTokens: number
  maxPromptTokens: number
  prices: { prompt: number; completion: number; request: number }
  output: { kind: 'json_schema' | 'tool'; name: string; schema: Record<string, unknown> }
  /** Mandatory application semantic gate; true only, not truthiness or async. */
  validate: (value: unknown) => boolean
  evidence?: { sourceHash: string; contractHash: string; role: string }
  providerSlug?: string
}
interface TestOptions {
  root: string
  historicalMicroUsd: number | null
  capMicroUsd?: number
  fetch: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
  mission?: Mission
}

/** Round the decimal API number upward exactly; never sum floating dollar values. */
export function usdToMicroUsd(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  const [mantissa, exponentText = '0'] = value.toString().toLowerCase().split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  const digits = BigInt(whole + fraction), power = Number(exponentText) - fraction.length + 6
  let result: bigint
  if (power >= 0) result = digits * BigInt(10) ** BigInt(power)
  else { const divisor = BigInt(10) ** BigInt(-power); result = (digits + divisor - BigInt(1)) / divisor }
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null
}
function prepare(request: QualificationRequest) {
  if (request.providerSlug !== undefined && !Object.prototype.hasOwnProperty.call(PROVIDERS, request.providerSlug)) fail('PROVIDER_FORBIDDEN')
  if (!(APPROVED_MODELS as readonly string[]).includes(request.model)) fail('MODEL_FORBIDDEN')
  if (!/^[a-f0-9]{64}$/.test(request.tupleHash) || !integer(request.attempt, 3) || request.attempt === 0 || !integer(request.maxCompletionTokens, MODEL_COMPLETION_LIMIT[request.model as keyof typeof MODEL_COMPLETION_LIMIT]) || request.maxCompletionTokens === 0 || !integer(request.maxPromptTokens, 2_000_000) || typeof request.validate !== 'function' || !Array.isArray(request.messages) || request.messages.length === 0 || request.messages.length > 100 || !request.messages.every(m => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string') || !request.output || !['json_schema', 'tool'].includes(request.output.kind) || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(request.output.name) || !request.output.schema || request.output.schema.type !== 'object') fail('INVALID_INPUT')
  const prices = request.prices
  if (!prices) fail('INVALID_INPUT')
  const p = usdToMicroUsd(prices.prompt), c = usdToMicroUsd(prices.completion), r = usdToMicroUsd(prices.request)
  if (p === null || c === null || r === null) fail('INVALID_INPUT')
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(m => ({ role: m.role, content: m.content })),
    max_tokens: request.maxCompletionTokens,
    stream: false,
    provider: { allow_fallbacks: false, require_parameters: true, ...(request.providerSlug ? { only: [request.providerSlug] } : {}), max_price: { prompt: prices.prompt, completion: prices.completion, request: prices.request } },
  }
  if (request.output.kind === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: request.output.name, strict: true, schema: request.output.schema } }
  else {
    body.tools = [{ type: 'function', function: { name: request.output.name, strict: true, parameters: request.output.schema } }]
    body.tool_choice = { type: 'function', function: { name: request.output.name } }
    body.parallel_tool_calls = false
  }
  let serialized: string
  try { serialized = JSON.stringify(body) } catch { return fail('INVALID_INPUT') }
  // Reserve the entire verified catalog context, never infer tokens from bytes.
  if (request.maxPromptTokens !== MODEL_CONTEXT[request.model as keyof typeof MODEL_CONTEXT]) fail('CONTEXT_BOUND_INVALID')
  if (Buffer.byteLength(serialized) > MAX_BYTES) fail('PROMPT_BOUND_EXCEEDED')
  const numerator = BigInt(request.maxPromptTokens) * BigInt(p) + BigInt(request.maxCompletionTokens) * BigInt(c)
  const reserved = (numerator + BigInt(999_999)) / BigInt(1_000_000) + BigInt(r)
  if (reserved > BigInt(CAP_MICRO_USD)) fail('BUDGET_EXCEEDED')
  const metadata = { evidence: request.evidence ?? null, requestedModel: request.model, maxPromptTokens: request.maxPromptTokens, maxCompletionTokens: request.maxCompletionTokens, prices: request.prices, transport: { endpoint: ENDPOINT, providerSlug: request.providerSlug ?? null, allowFallbacks: false, requireParameters: true, stream: false, outputKind: request.output.kind } }
  const reservation: Reservation = { tupleHash: request.tupleHash, requestHash: digest(serialized + JSON.stringify(metadata)), attempt: request.attempt, reservedMicroUsd: Math.max(1, Number(reserved)), metadata }
  return { serialized, reservation }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('OUTPUT_INVALID')
  return value as Record<string, unknown>
}
function outputValue(payload: Record<string, unknown>, request: QualificationRequest): unknown {
  if (payload.error || !Array.isArray(payload.choices) || payload.choices.length !== 1) fail('OUTPUT_INVALID')
  const choice = object(payload.choices[0]), message = object(choice.message)
  if (message.refusal) fail('OUTPUT_INVALID')
  let encoded: unknown
  if (request.output.kind === 'json_schema') {
    if (choice.finish_reason !== 'stop' || (message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) || message.tool_calls.length !== 0))) fail('OUTPUT_INVALID')
    encoded = message.content
  } else {
    if (choice.finish_reason !== 'tool_calls' || !Array.isArray(message.tool_calls) || message.tool_calls.length !== 1 || (message.content !== undefined && message.content !== null && message.content !== '')) fail('OUTPUT_INVALID')
    const tool = object(message.tool_calls[0]), fn = object(tool.function)
    if (tool.type !== 'function' || fn.name !== request.output.name) fail('OUTPUT_INVALID')
    encoded = fn.arguments
  }
  if (typeof encoded !== 'string') fail('OUTPUT_INVALID')
  try { const value: unknown = JSON.parse(encoded); if (request.validate(value) !== true) fail('OUTPUT_INVALID'); return value } catch { return fail('OUTPUT_INVALID') }
}

/** Real transport, but not reachable until independently reviewed release pins exist. */
export function createProvider(options?: { approvalToken: string; mission: Mission }) {
  checkApproval(options?.approvalToken)
  if (!options) fail('LIVE_NOT_APPROVED')
  const mission = ownMission(options.mission)
  return executionCore({ fetch: globalThis.fetch.bind(globalThis), mission, ledger: createLedger(mission), beforeExecute: () => checkApproval(options.approvalToken) })
}

/** No default fetch: tests MUST supply synthetic transport. Never reads dotenv/private files. */
export function createTestProvider(options: TestOptions) {
  if (process.env.NODE_ENV !== 'test') fail('TEST_ONLY')
  if (typeof options.fetch !== 'function' || options.fetch === globalThis.fetch) fail('SYNTHETIC_TRANSPORT_REQUIRED')
  return executionCore({ ...options, ledger: createTestLedger(options) })
}
function executionCore(options: { fetch: typeof fetch; ledger: ReturnType<typeof createTestLedger>; mission?: Mission; timeoutMs?: number; maxResponseBytes?: number; beforeExecute?: () => void }) {
  const mission = options.mission ? ownMission(options.mission) : undefined
  const timeoutMs = options.timeoutMs ?? 60_000, maxBytes = options.maxResponseBytes ?? MAX_BYTES
  if (!integer(timeoutMs, 300_000) || timeoutMs === 0 || !integer(maxBytes, MAX_BYTES) || maxBytes === 0) fail('INVALID_INPUT')
  const ledger = options.ledger
  return {
    async execute(input: QualificationRequest) {
      options.beforeExecute?.()
      // Own all data and the validator reference before any transport can yield
      // to caller code. Never validate a response against a mutable request.
      let request: QualificationRequest
      try {
        const { validate, ...data } = input
        request = { ...structuredClone(data), validate }
      } catch { return fail('INVALID_INPUT') }
      if (mission && (!request.evidence || !mission.sourceEvidence.includes(request.evidence.sourceHash) || request.evidence.contractHash !== (mission.roleContracts ? mission.roleContracts[request.evidence.role] : mission.contractHash) || mission.roleModels[request.evidence.role] !== request.model)) fail('MISSION_MISMATCH')
      if (options.beforeExecute && !request.providerSlug) fail('PROVIDER_REQUIRED')
      if (request.providerSlug === 'deepinfra/turbo' && request.output.kind === 'tool') fail('CAPABILITY_NOT_APPROVED')
      const { serialized, reservation } = prepare(request)
      const key = process.env.OPENROUTER_API_KEY
      if (!key || /[\r\n]/.test(key)) fail('KEY_MISSING')
      return ledger.withLock(async () => {
        ledger.reserve(reservation) // fsync before fetch, including on retry.
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new QualificationError('DEADLINE')); controller.abort() }, timeoutMs) })
        const chunks: Buffer[] = []
        let size = 0, costMicroUsd: number | null = null, value: unknown, code = 'OK'
        const started = performance.now()
        const telemetry: Telemetry = { requestedModel: request.model, returnedModel: null, provider: null, promptTokens: null, completionTokens: null, totalTokens: null, latencyMs: 0, costMicroUsd: null, errorCode: null, httpStatus: null }
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
        try {
          const response = await Promise.race([options.fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: serialized, redirect: 'error', signal: controller.signal }), deadline])
          telemetry.httpStatus = response.status
          if (!response.body) fail(response.ok ? 'OUTPUT_INVALID' : 'HTTP_ERROR')
          reader = response.body.getReader()
          for (;;) {
            const part = await Promise.race([reader.read(), deadline])
            if (part.done) break
            const remaining = maxBytes - size
            if (part.value.byteLength > remaining) { chunks.push(Buffer.from(part.value.subarray(0, remaining))); fail('RESPONSE_TOO_LARGE') }
            chunks.push(Buffer.from(part.value)); size += part.value.byteLength
          }
          let payload: Record<string, unknown>
          // Archive the bytes regardless of encoding. HTTP failure does not
          // require a JSON envelope; extract available usage before classifying.
          try { payload = object(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)))) } catch { return fail(response.ok ? 'OUTPUT_INVALID' : 'HTTP_ERROR') }
          const usage = payload.usage
          const safeLabel = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_./: -]{1,120}$/.test(v) ? v : null
          telemetry.returnedModel = safeLabel(payload.model)
          telemetry.provider = safeLabel(payload.provider)
          if (usage && typeof usage === 'object') {
            const u = usage as Record<string, unknown>
            telemetry.promptTokens = integer(u.prompt_tokens) ? u.prompt_tokens : null
            telemetry.completionTokens = integer(u.completion_tokens) ? u.completion_tokens : null
            telemetry.totalTokens = integer(u.total_tokens) ? u.total_tokens : null
          }
          if (usage && typeof usage === 'object') costMicroUsd = usdToMicroUsd((usage as Record<string, unknown>).cost)
          if (costMicroUsd !== null && costMicroUsd > reservation.reservedMicroUsd) fail('OVER_RESERVATION')
          if (!response.ok) fail('HTTP_ERROR')
          if (costMicroUsd === null) fail('COST_UNKNOWN')
          if (payload.model !== request.model) fail('MODEL_MISMATCH')
          if (request.providerSlug && payload.provider !== PROVIDERS[request.providerSlug]) fail('PROVIDER_MISMATCH')
          value = outputValue(payload, request)
        } catch (e) { code = e instanceof QualificationError ? e.code : 'TRANSPORT_ERROR' }
        finally {
          if (timer) clearTimeout(timer)
          controller.abort()
          if (reader) void reader.cancel().catch(() => undefined)
        }
        telemetry.latencyMs = Math.max(0, Math.ceil(performance.now() - started))
        telemetry.costMicroUsd = costMicroUsd
        telemetry.errorCode = code === 'OK' ? null : code
        ledger.settle(reservation, { costMicroUsd, status: code === 'OK' ? 'success' : 'error', code, telemetry }, Buffer.concat(chunks))
        if (code !== 'OK') fail(code)
        return { value, model: request.model, tupleHash: reservation.tupleHash, attempt: reservation.attempt, costMicroUsd, requestHash: reservation.requestHash, telemetry }
      })
    },
  }
}
