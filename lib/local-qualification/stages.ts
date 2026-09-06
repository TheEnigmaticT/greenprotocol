import { sha256 } from './source'
import { digest as rawDigest } from './manifests'
import { prepareExtractionRequests } from './extraction-jobs'
import { validLocalTimeoutRecovery } from './local-transport'
import type { ArtifactStore } from './stage-store'
import type { IsolatedAnalysisOptions } from './analysis'
import { PRINCIPLE_IDS, PRINCIPLES, type PrincipleID } from './principles'

export type StageID = 'extraction' | 'coverage' | 'claim-audit' | PrincipleID | 'applicability' | 'assembly' | 'rescore' | 'acceptance'
export type StageStatus = 'candidate' | 'unavailable' | 'unimplemented' | 'failed' | 'blocked'
export type StageCode = 'CANDIDATE' | 'UNAVAILABLE' | 'UNIMPLEMENTED' | 'DEPENDENCY_BLOCKED' | 'JOB_FAILED' | 'OUTPUT_INVALID' | 'INTERRUPTED' | 'DEADLINE' | 'RUN_HALTED'
export const STAGES: readonly { readonly id: StageID; readonly dependencies: readonly StageID[] }[] = Object.freeze([
  { id: 'extraction' as const, dependencies: [] },
  { id: 'coverage' as const, dependencies: ['extraction'] },
  { id: 'claim-audit' as const, dependencies: ['extraction', 'coverage'] },
  ...PRINCIPLE_IDS.map(id => ({ id, dependencies: ['extraction', 'coverage', 'claim-audit'] })),
  { id: 'applicability' as const, dependencies: [...PRINCIPLE_IDS] },
  { id: 'assembly' as const, dependencies: ['applicability'] },
  { id: 'rescore' as const, dependencies: ['assembly'] },
  { id: 'acceptance' as const, dependencies: ['coverage', 'claim-audit', ...PRINCIPLE_IDS, 'applicability', 'assembly', 'rescore'] },
].map(s => Object.freeze({ id: s.id, dependencies: Object.freeze(s.dependencies as StageID[]) })))
export interface StageBinding {
  readonly sourceId: string
  readonly sourceVersion: string
  readonly evidenceHash: string
  readonly evidenceVersion: string
  readonly contractVersion: string
}
export interface RoleIdentity {
  readonly family: 'Qwen' | 'Gemma'
  /** Exact reviewed identity supplied by the caller, never inferred from a family or alias. */
  readonly model: string
  readonly modelVersion: string
  readonly roleVersion: string
  readonly transportVersion: string
}
export interface StageResult {
  readonly stage: StageID
  readonly tupleHash: string
  readonly attempt: 1
  readonly status: StageStatus
  readonly code: StageCode
  readonly artifactHash: string | null
  readonly dependencyHashes: readonly string[]
  readonly principleImplementationStatus: 'contract-implemented-job-not-implemented' | null
}
export interface StageRunResult {
  readonly runId: string
  readonly binding: StageBinding
  readonly stages: readonly StageResult[]
  readonly safetyCertified: false
  readonly allTwelveSafe: false
  readonly ready: false
}
export interface StageContext {
  readonly stage: StageID
  readonly tupleHash: string
  readonly attempt: 1
  readonly binding: StageBinding
  readonly identity: RoleIdentity
  readonly dependencies: readonly StageResult[]
  readonly signal: AbortSignal
}
export interface StageJob {
  readonly implementationVersion: string
  /** Only references to privately persisted results cross this boundary; no source or evidence text. */
  execute(context: StageContext): Promise<unknown>
  /** Mandatory synchronous semantic gate; transport success alone is insufficient. */
  validate(value: unknown): boolean
}
/** Trusted private adapter: exclusive must serialize ALL runs, including across processes.
 * append must be create-only, durable before resolving (fsync or transactional equivalent).
 * read returns exact bytes, bounded to 16 KiB. No stale lock stealing after uncertain execution.
 * Implementations own private path/owner/access controls. This module supplies no filesystem default. */
export interface StageStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): Promise<string | null>
  append(key: string, raw: string): Promise<void>
}
export interface StageOptions {
  binding: StageBinding
  config: { readonly reviewId: string; readonly roles: Readonly<Partial<Record<StageID, RoleIdentity>>> }
  jobs: Partial<Record<StageID, StageJob>>
  store: StageStore
  timeoutMs: number
}
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const token = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)
const digest = (value: unknown) => sha256(JSON.stringify(value)).slice(7)
function error(code: string): never { throw new Error(code) }
const codes: Record<StageStatus, readonly StageCode[]> = {
  candidate: ['CANDIDATE'], unavailable: ['UNAVAILABLE'], unimplemented: ['UNIMPLEMENTED'],
  failed: ['JOB_FAILED', 'OUTPUT_INVALID', 'INTERRUPTED', 'DEADLINE'], blocked: ['DEPENDENCY_BLOCKED', 'RUN_HALTED'],
}
function freezeResult(result: StageResult): StageResult {
  return Object.freeze({ ...result, dependencyHashes: Object.freeze([...result.dependencyHashes]) })
}
function prepare(options: StageOptions) {
  const { config } = options
  if (!config || !Object.isFrozen(config) || !token(config.reviewId) || !config.roles || !Object.isFrozen(config.roles)) error('CONFIG_INVALID')
  const known = new Set<string>(STAGES.map(s => s.id))
  if (Object.keys(config.roles).some(k => !known.has(k)) || Object.keys(options.jobs).some(k => !known.has(k))) error('CONFIG_INVALID')
  const roles: Partial<Record<StageID, RoleIdentity>> = {}, jobs: Partial<Record<StageID, StageJob>> = {}
  for (const stage of STAGES) {
    const role = config.roles[stage.id], job = options.jobs[stage.id]
    if (role) {
      if (!Object.isFrozen(role) || !['Qwen', 'Gemma'].includes(role.family) || ![role.model, role.modelVersion, role.roleVersion, role.transportVersion].every(token)) error('CONFIG_INVALID')
      roles[stage.id] = Object.freeze({ family: role.family, model: role.model, modelVersion: role.modelVersion, roleVersion: role.roleVersion, transportVersion: role.transportVersion })
    }
    if (job) {
      if (!token(job.implementationVersion) || typeof job.execute !== 'function' || typeof job.validate !== 'function') error('CONFIG_INVALID')
      jobs[stage.id] = Object.freeze({ implementationVersion: job.implementationVersion, execute: job.execute.bind(job), validate: job.validate.bind(job) })
    }
  }
  const b = options.binding
  if (!b || typeof b.sourceId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(b.sourceId) || !hash(b.evidenceHash) || ![b.sourceVersion, b.evidenceVersion, b.contractVersion].every(token)) error('BINDING_INVALID')
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 300_000) error('BOUND_INVALID')
  const binding = Object.freeze({ sourceId: b.sourceId, sourceVersion: b.sourceVersion, evidenceHash: b.evidenceHash, evidenceVersion: b.evidenceVersion, contractVersion: b.contractVersion })
  const manifest = { schema: 'isolated-stages/v1', binding, reviewId: config.reviewId, roles, jobs: STAGES.map(s => [s.id, jobs[s.id]?.implementationVersion ?? null]), dag: STAGES, timeoutMs: options.timeoutMs }
  return { binding, roles, jobs, runId: digest(manifest), timeoutMs: options.timeoutMs, manifest }
}
async function invoke(job: StageJob, context: Omit<StageContext, 'signal'>, timeoutMs: number): Promise<Pick<StageResult, 'status' | 'code' | 'artifactHash'>> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const failed = (code: StageCode) => ({ status: 'failed' as const, code, artifactHash: null })
  try {
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error('DEADLINE')); controller.abort() }, timeoutMs) })
    // A rejected/late provider promise is observed by race and cannot write results.
    const value = await Promise.race([Promise.resolve().then(() => job.execute(Object.freeze({ ...context, signal: controller.signal }))), deadline])
    const output = value as { status?: unknown; artifactHash?: unknown } | null
    if (!output || typeof output !== 'object' || !['candidate', 'unavailable', 'unimplemented'].includes(output.status as string)) return failed('OUTPUT_INVALID')
    let valid = false
    try { valid = job.validate(value) === true } catch { /* redacted semantic failure */ }
    if (!valid || (output.status === 'candidate' && !hash(output.artifactHash))) return failed('OUTPUT_INVALID')
    const status = output.status as 'candidate' | 'unavailable' | 'unimplemented'
    return { status, code: codes[status][0], artifactHash: status === 'candidate' ? output.artifactHash as string : null }
  } catch {
    return failed(controller.signal.aborted ? 'DEADLINE' : 'JOB_FAILED')
  } finally { if (timer) clearTimeout(timer); controller.abort() }
}

class RecoveryError extends Error {}
function recoveryError(code: string): never { throw new RecoveryError('STAGE_RECOVERY_' + code) }
interface FenceRecovery {
  schema: 'local-stage-timeout-recovery/v1'; runId: string; stage: StageID; tupleHash: string
  stageStartHash: string; stageResultHash: string; manifestHash: string
  transportIndex: number; transportStart: string; transportResult: string; transportRecovery: string
  operator: string; checkedAt: string
}
async function validateFenceRecovery(store: StageStore, raw: string, tupleHash: string): Promise<{ contractVersion: string; sourceId: string; timeoutMs: number }> {
  let a: FenceRecovery
  try { a = JSON.parse(raw) } catch { return error('ARTIFACT_INVALID') }
  if (!a || a.schema !== 'local-stage-timeout-recovery/v1' || !hash(a.runId) || a.tupleHash !== tupleHash ||
      !STAGES.some(s => s.id === a.stage) || !token(a.operator) || !Number.isFinite(Date.parse(a.checkedAt)) ||
      !Number.isSafeInteger(a.transportIndex) || a.transportIndex < 0 || a.transportIndex >= 4096 ||
      !validLocalTimeoutRecovery(a.transportRecovery, a.transportStart, a.transportResult)) error('ARTIFACT_INVALID')
  const key = `${a.runId}/${a.stage}/${tupleHash}/1`
  const start = await store.read(key + '/start'), result = await store.read(key + '/result'), manifest = await store.read(a.runId + '/manifest')
  if (start === null || result === null || manifest === null || rawDigest(start) !== a.stageStartHash ||
      rawDigest(result) !== a.stageResultHash || rawDigest(manifest) !== a.manifestHash || rawDigest(manifest) !== a.runId) error('ARTIFACT_INVALID')
  try {
    const s = JSON.parse(start), r = JSON.parse(result), m = JSON.parse(manifest)
    if (s.tupleHash !== tupleHash || s.stage !== a.stage || s.attempt !== 1 || r.result.tupleHash !== tupleHash ||
        r.result.stage !== a.stage || r.result.attempt !== 1 || r.result.status !== 'failed' || r.result.code !== 'JOB_FAILED' ||
        r.hash !== digest(r.result) || tupleHash !== digest({ runId: a.runId, stage: a.stage, dependencyHashes: r.result.dependencyHashes })) error('ARTIFACT_INVALID')
    return { contractVersion: m.binding.contractVersion, sourceId: m.binding.sourceId, timeoutMs: m.timeoutMs }
  } catch { return error('ARTIFACT_INVALID') }
}
/** Explicit operator action only. No fetch, cancellation, retry, settlement rewrite,
 * or stale-lock repair. Requires the independently persisted transport acknowledgment.
 * Legacy single-window extraction/inventory is reconstructed from the exact old
 * execution contract; ambiguous multi-window or deadline/interrupted work is refused. */
export async function acknowledgeLocalStageTimeout(options: {
  stageStore: StageStore; transportStore: StageStore; artifactStore: ArtifactStore
  analysis: Pick<IsolatedAnalysisOptions, 'source' | 'extraction' | 'inventory' | 'policyVersion' | 'evidenceHash' | 'localTransportTimeoutMs'>
  runId: string; stage: StageID; fenceIndex: number; transportIndex: number
  expectedStageResultHash: string; expectedTransportResultHash: string; operator: string
}): Promise<void> {
  const o = options
  if (![o.runId, o.expectedStageResultHash, o.expectedTransportResultHash].every(hash) ||
      ![o.fenceIndex, o.transportIndex].every(i => Number.isSafeInteger(i) && i >= 0 && i < 4096) ||
      !STAGES.some(s => s.id === o.stage) || typeof o.operator !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(o.operator)) recoveryError('INVALID')
  // Lock order matches analysis execution: stage first, transport second.
  const outcome = await o.stageStore.exclusive('isolated-stages/global', () => o.transportStore.exclusive('local-transport/global', async () => {
    try {
      const prefix = `execution-fence/${o.fenceIndex}`
      if (await o.stageStore.read(prefix + '/recovery') !== null) recoveryError('EXISTS')
      const tupleHash = await o.stageStore.read(prefix + '/start')
      if (!hash(tupleHash) || await o.stageStore.read(prefix + '/settled') !== null) recoveryError('INELIGIBLE')
      const key = `${o.runId}/${o.stage}/${tupleHash}/1`
      const start = await o.stageStore.read(key + '/start'), result = await o.stageStore.read(key + '/result'), manifest = await o.stageStore.read(o.runId + '/manifest')
      const tp = `local-transport/${o.transportIndex}`
      const ts = await o.transportStore.read(tp + '/start'), tr = await o.transportStore.read(tp + '/result'), ta = await o.transportStore.read(tp + '/recovery')
      if (start === null || result === null || manifest === null || ts === null || tr === null || ta === null) recoveryError('INELIGIBLE')
      if (rawDigest(result) !== o.expectedStageResultHash || rawDigest(tr) !== o.expectedTransportResultHash || !validLocalTimeoutRecovery(ta, ts, tr)) recoveryError('MISMATCH')
      const receipt = JSON.parse(ts), m = JSON.parse(manifest)
      const { source, extraction, inventory, policyVersion, evidenceHash, localTransportTimeoutMs } = o.analysis
      const contractVersion = rawDigest(JSON.stringify({ version: 'isolated-analysis-v2', extraction, inventory, policyVersion, evidenceHash, ...(localTransportTimeoutMs === undefined ? {} : { localTransportTimeoutMs }) }))
      if (m.binding.contractVersion !== contractVersion || m.binding.sourceId !== source.id || receipt.evidence.sourceHash !== source.id.slice(7)) recoveryError('MISMATCH')
      if (o.stage === 'extraction' || o.stage === 'coverage') {
        const requests = prepareExtractionRequests(source, o.stage === 'extraction' ? extraction : inventory)
        if (requests.length !== 1) recoveryError('INELIGIBLE')
        const { validate: _validate, ...request } = requests[0]
        // The digest commits the request, but separately stored receipt fields
        // must agree with it too; a self-consistent receipt can still contradict it.
        if (receipt.tupleHash !== request.tupleHash || receipt.requestHash !== rawDigest(JSON.stringify(request)) ||
            receipt.model !== request.model || receipt.attempt !== request.attempt ||
            receipt.evidence.sourceHash !== request.evidence?.sourceHash ||
            receipt.evidence.contractHash !== request.evidence?.contractHash ||
            receipt.evidence.role !== request.evidence?.role) recoveryError('MISMATCH')
      } else if (!(PRINCIPLE_IDS as readonly string[]).includes(o.stage) || receipt.tupleHash !== tupleHash || receipt.evidence.role !== o.stage || receipt.model !== m.roles[o.stage]?.model) recoveryError('INELIGIBLE')
      const empty = await o.artifactStore.read(rawDigest(''))
      if (empty === null || empty.length !== 0) recoveryError('INELIGIBLE')
      const record: FenceRecovery = { schema: 'local-stage-timeout-recovery/v1', runId: o.runId, stage: o.stage, tupleHash,
        stageStartHash: rawDigest(start), stageResultHash: rawDigest(result), manifestHash: rawDigest(manifest),
        transportIndex: o.transportIndex, transportStart: ts, transportResult: tr, transportRecovery: ta, operator: o.operator, checkedAt: new Date().toISOString() }
      const raw = JSON.stringify(record)
      await validateFenceRecovery(o.stageStore, raw, tupleHash)
      await o.stageStore.append(prefix + '/recovery', raw)
      if (await o.stageStore.read(prefix + '/recovery') !== raw) error('ARTIFACT_INVALID')
      return {}
    } catch (e) {
      if (e instanceof RecoveryError) return { error: e }
      // Validation errors are expected refusals; unknown storage errors retain locks.
      if (e instanceof SyntaxError || (e instanceof Error && e.message === 'ARTIFACT_INVALID')) return { error: new RecoveryError('STAGE_RECOVERY_INELIGIBLE') }
      throw e
    }
  }))
  if (outcome.error) throw outcome.error
}

/** Serial substrate only. Existing provider retains sole spending/retry/attestation authority.
 * Candidates are not approvals; even an entirely candidate run never passes READY or safety. */
export async function runStages(options: StageOptions): Promise<StageRunResult> {
  const prepared = prepare(options)
  const { binding, roles, jobs, runId, timeoutMs, manifest } = prepared
  const store = options.store
  // Capture adapter methods before yielding. A shared store MUST enforce this global lock.
  const read = store.read.bind(store), append = store.append.bind(store)
  async function persist(key: string, raw: string) {
    await append(key, raw)
    if (await read(key) !== raw) error('ARTIFACT_INVALID')
  }
  return store.exclusive('isolated-stages/global', async () => {
    const manifestKey = `${runId}/manifest`
    const previousManifest = await read(manifestKey)
    if (previousManifest === null) await persist(manifestKey, JSON.stringify(manifest))
    else if (previousManifest !== JSON.stringify(manifest)) error('ARTIFACT_INVALID')
    const results: StageResult[] = []
    // Bounded append-only global execution fence: an unsettled provider invocation
    // blocks every later tuple, including after a crash or failed result write.
    // This is not a spending ledger and never authorizes a retry/reset.
    let halted = false
    let fenceIndex = 0
    const fenceLimit = 4096
    for (; fenceIndex < fenceLimit; fenceIndex++) {
      const started = await read(`execution-fence/${fenceIndex}/start`)
      const settled = await read(`execution-fence/${fenceIndex}/settled`)
      if (started === null) {
        if (settled !== null) error('ARTIFACT_INVALID')
        break
      }
      if (!hash(started)) error('ARTIFACT_INVALID')
      if (settled === null) {
        const recovery = await read(`execution-fence/${fenceIndex}/recovery`)
        if (recovery === null) { halted = true; break }
        const old = await validateFenceRecovery(store, recovery, started)
        // A new review label alone does not change the execution contract.
        if (old.sourceId === binding.sourceId && old.contractVersion === binding.contractVersion && old.timeoutMs === timeoutMs) { halted = true; break }
        continue
      }
      if (settled !== started) error('ARTIFACT_INVALID')
    }
    if (fenceIndex === fenceLimit) halted = true
    for (const stage of STAGES) {
      const dependencies = Object.freeze(stage.dependencies.map(id => results.find(r => r.stage === id)!))
      const dependencyHashes = Object.freeze(dependencies.map(digest))
      const tupleHash = digest({ runId, stage: stage.id, dependencyHashes })
      const key = `${runId}/${stage.id}/${tupleHash}/1`
      const base = { stage: stage.id, tupleHash, attempt: 1 as const, dependencyHashes, principleImplementationStatus: (PRINCIPLE_IDS as readonly string[]).includes(stage.id) ? PRINCIPLES[stage.id as PrincipleID].implementationStatus : null }
      const start = JSON.stringify({ schema: 'stage-start/v1', ...base })
      const priorStart = await read(`${key}/start`)
      const priorResult = await read(`${key}/result`)
      let result: StageResult
      if (priorResult !== null) {
        if (priorStart !== start || priorResult.length > 16_384) error('ARTIFACT_INVALID')
        try {
          const parsed = JSON.parse(priorResult) as { result: StageResult; hash: string }
          const r = parsed.result
          if (!r || digest(r) !== parsed.hash || !Object.hasOwn(codes, r.status) || !codes[r.status].includes(r.code) || (r.status === 'candidate' ? !hash(r.artifactHash) : r.artifactHash !== null) || JSON.stringify({ stage: r.stage, tupleHash: r.tupleHash, attempt: r.attempt, dependencyHashes: r.dependencyHashes, principleImplementationStatus: r.principleImplementationStatus }) !== JSON.stringify(base) || Object.keys(r).length !== 8) error('ARTIFACT_INVALID')
          result = freezeResult(r)
        } catch { return error('ARTIFACT_INVALID') }
      } else {
        if (priorStart !== null && priorStart !== start) error('ARTIFACT_INVALID')
        if (priorStart === null) await persist(`${key}/start`, start)
        let outcome: Pick<StageResult, 'status' | 'code' | 'artifactHash'>
        if (priorStart !== null) outcome = { status: 'failed', code: 'INTERRUPTED', artifactHash: null }
        else if (halted) outcome = { status: 'blocked', code: 'RUN_HALTED', artifactHash: null }
        else if (dependencies.some(r => r.status !== 'candidate')) outcome = { status: 'blocked', code: 'DEPENDENCY_BLOCKED', artifactHash: null }
        else if (!jobs[stage.id]) outcome = { status: 'unimplemented', code: 'UNIMPLEMENTED', artifactHash: null }
        else if (!roles[stage.id]) outcome = { status: 'unavailable', code: 'UNAVAILABLE', artifactHash: null }
        else {
          await persist(`execution-fence/${fenceIndex}/start`, tupleHash)
          outcome = await invoke(jobs[stage.id]!, { stage: stage.id, tupleHash, attempt: 1, binding, identity: roles[stage.id]!, dependencies }, timeoutMs)
        }
        result = freezeResult({ ...base, ...outcome })
        await persist(`${key}/result`, JSON.stringify({ result, hash: digest(result) }))
        // An arbitrary rejection may hide an uncancelled provider request.
        // Only a normally returned result establishes adapter completion.
        if (!halted && await read(`execution-fence/${fenceIndex}/start`) === tupleHash && !['DEADLINE', 'JOB_FAILED'].includes(result.code)) {
          await persist(`execution-fence/${fenceIndex}/settled`, tupleHash)
          fenceIndex++
          if (fenceIndex === fenceLimit) halted = true
        }
      }
      if (['INTERRUPTED', 'DEADLINE', 'JOB_FAILED'].includes(result.code)) halted = true
      results.push(result)
    }
    return Object.freeze({ runId, binding, stages: Object.freeze(results), safetyCertified: false, allTwelveSafe: false, ready: false })
  })
}
