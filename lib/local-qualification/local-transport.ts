import { OllamaDecomposedProvider, OllamaProviderError, OLLAMA_PILOT_MODELS } from '../decomposed-benchmark/ollama-provider'
import type { ExtractionJobTransport } from './extraction-jobs'
import type { ArtifactStore } from './stage-store'
import type { StageStore } from './stages'
import { digest } from './manifests'

/** Operator-supplied local consent pins. NOT a hosted release approval or science certification. */
export interface LocalAuthorization {
  mode: 'LOCAL'
  authorized: true
  reviewId: string
  sourceHashes: readonly string[]
  roleContracts: Readonly<Record<string, string>>
}
const hash = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)
class LocalError extends Error {}
function fail(code: string): never { throw new LocalError('LOCAL_' + code) }
export function localRoleModel(role: string): string | null {
  if (role === 'extraction' || /^P(?:[1-9]|1[0-2])$/.test(role)) return OLLAMA_PILOT_MODELS[0]
  if (role === 'inventory' || /^applicability-P(?:[1-9]|1[0-2])$/.test(role)) return OLLAMA_PILOT_MODELS[1]
  return null
}
const PS_URL = 'http://localhost:11434/api/ps'
function timeoutReceipt(start: string, result: string) {
  let s, r
  try { s = JSON.parse(start); r = JSON.parse(result) } catch { return fail('PERSISTENCE_INVALID') }
  if (!s || !r || !hash(s.tupleHash) || !hash(s.requestHash) || !hash(s.authorizationHash) || s.attempt !== 1 ||
      !s.evidence || !hash(s.evidence.sourceHash) || !hash(s.evidence.contractHash) || !localRoleModel(s.evidence.role) || s.model !== localRoleModel(s.evidence.role) ||
      r.startHash !== digest(start) || r.status !== 'error' || r.code !== 'TIMEOUT' || r.rawHash !== digest('') || r.telemetry !== null) fail('RECOVERY_INELIGIBLE')
  return { s, r }
}
export function validLocalTimeoutRecovery(raw: string, start: string, result: string): boolean {
  try {
    timeoutReceipt(start, result)
    const a = JSON.parse(raw)
    return a.schema === 'local-timeout-recovery/v1' && a.startHash === digest(start) && a.resultHash === digest(result) &&
      typeof a.operator === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(a.operator) &&
      typeof a.checkedAt === 'string' && Number.isFinite(Date.parse(a.checkedAt)) && a.endpoint === PS_URL && Array.isArray(a.models) && a.models.length === 0
  } catch { return false }
}
/** OPERATOR ONLY: after stopping Ollama work, acknowledge one exact empty-response
 * timeout. Never called by execution; never retries, repairs storage, or settles a
 * stage fence. Use a fresh transport and a different tuple after acknowledgment. */
export async function acknowledgeLocalTimeout(options: {
  stageStore: StageStore; artifactStore: ArtifactStore; index: number
  expectedResultHash: string; operator: string; fetch?: typeof fetch
}): Promise<void> {
  const { stageStore, artifactStore, index, expectedResultHash, operator } = options
  if (!Number.isSafeInteger(index) || index < 0 || index >= 4096 || !hash(expectedResultHash) ||
      typeof operator !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(operator)) fail('RECOVERY_INVALID')
  if (options.fetch && (process.env.NODE_ENV !== 'test' || options.fetch === globalThis.fetch)) fail('TEST_ONLY')
  const fetcher = options.fetch ?? globalThis.fetch
  const outcome = await stageStore.exclusive('local-transport/global', async () => {
    try {
      const prefix = `local-transport/${index}`
      if (await stageStore.read(prefix + '/recovery') !== null) fail('RECOVERY_EXISTS')
      const start = await stageStore.read(prefix + '/start'), result = await stageStore.read(prefix + '/result')
      if (start === null || result === null) fail('RECOVERY_INELIGIBLE')
      if (digest(result) !== expectedResultHash) fail('RECOVERY_MISMATCH')
      const { r } = timeoutReceipt(start, result)
      const raw = await artifactStore.read(r.rawHash)
      if (raw === null || raw.length !== 0 || digest(raw) !== r.rawHash) fail('PERSISTENCE_INVALID')
      let response, body
      try {
        response = await fetcher(PS_URL, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000) })
        if (!response.ok || response.redirected) fail('OLLAMA_NOT_IDLE')
        body = await response.json()
      } catch { return { error: new LocalError('LOCAL_OLLAMA_NOT_IDLE') } }
      if (!body || !Array.isArray(body.models) || body.models.length !== 0) fail('OLLAMA_NOT_IDLE')
      const acknowledgment = JSON.stringify({ schema: 'local-timeout-recovery/v1', startHash: digest(start), resultHash: expectedResultHash, operator, checkedAt: new Date().toISOString(), endpoint: PS_URL, models: [] })
      await stageStore.append(prefix + '/recovery', acknowledgment)
      if (await stageStore.read(prefix + '/recovery') !== acknowledgment) fail('PERSISTENCE_INVALID')
      return {}
    } catch (error) { if (error instanceof LocalError) return { error }; throw error }
  })
  if (outcome.error) throw outcome.error
}
/** Reuses exact Ollama runtime settings, serial scheduling and fail-stop behavior.
 * Dedicated durable transport fence also blocks a new instance after uncertainty.
 * Injected stores are trusted private capabilities; native entrypoint supplies them.
 * No credentials, paid ledger, cloud fallback, retries, or endpoint override.
 */
export function createLocalQualificationTransport(options: {
  authorization: LocalAuthorization; stageStore: StageStore; artifactStore: ArtifactStore
  timeoutMs?: number; fetch?: typeof fetch
}): ExtractionJobTransport {
  const authorization = structuredClone(options.authorization)
  if (!authorization || authorization.mode !== 'LOCAL' || authorization.authorized !== true ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(authorization.reviewId) ||
      !Array.isArray(authorization.sourceHashes) || !authorization.sourceHashes.length || !authorization.sourceHashes.every(hash) ||
      !authorization.roleContracts || !Object.keys(authorization.roleContracts).length ||
      !Object.entries(authorization.roleContracts).every(([role, contract]) => localRoleModel(role) && hash(contract))) fail('NOT_AUTHORIZED')
  if (options.fetch && (process.env.NODE_ENV !== 'test' || options.fetch === globalThis.fetch)) fail('TEST_ONLY')
  const adapter = new OllamaDecomposedProvider({ timeoutMs: options.timeoutMs ?? 55_000, ...(options.fetch ? { fetch: options.fetch } : {}) })
  const exclusive = options.stageStore.exclusive.bind(options.stageStore), read = options.stageStore.read.bind(options.stageStore), append = options.stageStore.append.bind(options.stageStore)
  const put = options.artifactStore.put.bind(options.artifactStore), readArtifact = options.artifactStore.read.bind(options.artifactStore)
  async function persist(key: string, value: unknown) {
    const raw = JSON.stringify(value); await append(key, raw)
    if (await read(key) !== raw) fail('PERSISTENCE_INVALID')
  }
  return { async execute(input) {
    const { validate, ...data } = input
    const request = { ...structuredClone(data), validate }, e = request.evidence
    if (!e || !authorization.sourceHashes.includes(e.sourceHash) || authorization.roleContracts[e.role] !== e.contractHash ||
        request.model !== localRoleModel(e.role) || request.providerSlug !== 'ollama') fail('BINDING_INVALID')
    // The reused runtime is fixed at 16K context/2048 output. Reject, never silently widen or truncate a declared bound.
    if (!hash(request.tupleHash) || request.attempt !== 1 || request.output?.kind !== 'json_schema' || request.output.schema?.type !== 'object' ||
        request.maxCompletionTokens !== 2048 || !Number.isSafeInteger(request.maxPromptTokens) || request.maxPromptTokens <= 0 || request.maxPromptTokens > 14336 ||
        !Array.isArray(request.messages) || request.messages.length !== 2 || request.messages[0].role !== 'system' || request.messages[1].role !== 'user' ||
        !request.messages.every(m => typeof m.content === 'string') || typeof validate !== 'function' ||
        !request.prices || !['prompt', 'completion', 'request'].every(k => request.prices[k as keyof typeof request.prices] === 0) ||
        Buffer.byteLength(JSON.stringify({ model: request.model, messages: request.messages, output: request.output })) + 2048 > request.maxPromptTokens) fail('REQUEST_INVALID')
    const requestHash = digest(JSON.stringify(data)), authorizationHash = digest(JSON.stringify(authorization))
    const work = async () => {
      let index = 0
      for (; index < 4096; index++) {
        const start = await read(`local-transport/${index}/start`), result = await read(`local-transport/${index}/result`)
        if (start === null) { if (result !== null) fail('PERSISTENCE_INVALID'); break }
        if (result === null) fail('HALTED')
        let started, settled
        try { started = JSON.parse(start); settled = JSON.parse(result) } catch { return fail('PERSISTENCE_INVALID') }
        if (settled.startHash !== digest(start) || !hash(settled.rawHash)) fail('PERSISTENCE_INVALID')
        const raw = await readArtifact(settled.rawHash)
        if (!raw || digest(raw) !== settled.rawHash) fail('PERSISTENCE_INVALID')
        if (settled.status !== 'success') {
          const recovery = await read(`local-transport/${index}/recovery`)
          if (recovery === null) fail('HALTED')
          if (!validLocalTimeoutRecovery(recovery, start, result)) fail('PERSISTENCE_INVALID')
        }
        if (started.tupleHash === request.tupleHash) fail('REPLAY')
      }
      if (index === 4096) fail('HALTED')
      const prefix = `local-transport/${index}`
      const start = { tupleHash: request.tupleHash, requestHash, authorizationHash, evidence: e, model: request.model, attempt: 1 }
      await persist(prefix + '/start', start)
      let raw = '', code = 'OK', value: unknown, telemetry: unknown = null
      try {
        const response = await adapter.completeJson({ model: request.model, stage: e.role, system: request.messages[0].content, user: request.messages[1].content, schema: request.output.schema })
        raw = response.rawResponse
        telemetry = { model: response.model, provider: response.provider, usage: response.usage, latencyMs: response.latencyMs, costUsd: response.costUsd }
        if (validate(response.data) !== true) fail('OUTPUT_INVALID')
        value = response.data
      } catch (error) {
        if (error instanceof OllamaProviderError) { raw = error.rawResponse; code = error.code }
        else code = 'OUTPUT_INVALID'
      }
      const bytes = Buffer.from(raw), rawHash = digest(bytes)
      if (await put(bytes) !== rawHash || !(await readArtifact(rawHash))?.equals(bytes)) fail('PERSISTENCE_INVALID')
      await persist(prefix + '/result', { startHash: digest(JSON.stringify(start)), status: code === 'OK' ? 'success' : 'error', code, rawHash, telemetry })
      if (code !== 'OK') fail(code)
      return { value, model: request.model, tupleHash: request.tupleHash, attempt: request.attempt }
    }
    // Expected refusals release the lock, but durable failed/unsettled receipts
    // still block all future sends. Unknown storage failures retain its lock.
    const outcome = await exclusive('local-transport/global', async () => {
      try { return { response: await work() } }
      catch (error) { if (error instanceof LocalError) return { error }; throw error }
    })
    if (outcome.error) throw outcome.error
    return outcome.response!
  } }
}
