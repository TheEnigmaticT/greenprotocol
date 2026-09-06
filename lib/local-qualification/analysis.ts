import { assertSource, createSource, type Source } from './source'
import { type GraphRevision } from './graph'
import { runExtractionJob, runInventoryJob, auditExtractionJobs, type ExtractionJobManifest, type ExtractionJobResult, type InventoryJobResult, type ExtractionJobTransport } from './extraction-jobs'
import { buildPrincipleJob, buildApplicabilityJob, type BoundedJob, type PrincipleJobInput, type PrincipleJobResult } from './principle-jobs'
import { serializeEvidenceArtifact, type AuditContext } from './evidence'
import { PRINCIPLE_IDS, type PrincipleID } from './principles'
import { createDecision, summarizeDecisions } from './decisions'
import { APPROVED_MODELS, createProvider, type QualificationRequest } from './provider'
import { createLocalQualificationTransport, localRoleModel, type LocalAuthorization } from './local-transport'
import { digest, type Mission } from './manifests'
import { createArtifactStore, createStageStore, createLocalTransportStore, type ArtifactStore } from './stage-store'
import { runStages, STAGES, type StageContext, type StageID, type StageJob, type StageStore, type StageResult } from './stages'

export interface IsolatedAnalysisOptions {
  source: Source
  extraction: ExtractionJobManifest
  inventory: ExtractionJobManifest
  reviewId: string
  policyVersion: string
  evidenceHash: string
  timeoutMs: number
  /** Local request deadline; included in the execution contract when explicit. */
  localTransportTimeoutMs?: number
  stageStore: StageStore
  artifactStore: ArtifactStore
  transport: ExtractionJobTransport
  /** Trusted versioned policy, not worker-defined eligibility or invented evidence.
   * Must reconcile against the complete graph. Unavailable dependencies stay empty. */
  principlePolicy(principle: PrincipleID, source: Source, graph: GraphRevision): PrincipleJobInput | null
  /** Separate authenticated review policy; absent is explicitly unavailable. */
  applicabilityPolicy?(input: PrincipleJobInput, worker: PrincipleJobResult): AuditContext | null
}
function invalid(): never { throw new Error('ANALYSIS_INVALID') }
/** Pins precisely the schema/instructions used at execution, without chemistry claims. */
export function principleRequestContractHash(policyVersion: string, evidenceHash: string, principle: PrincipleID, bounded: Pick<BoundedJob<unknown>, 'output' | 'messages'>): string {
  return digest(JSON.stringify({ version: 'isolated-analysis-v2', policyVersion, evidenceHash, principle, output: bounded.output, instructions: bounded.messages[0].content }))
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
interface CoverageArtifact { extractionHash: string; inventory: InventoryJobResult; audit: ReturnType<typeof auditExtractionJobs> }
interface ClaimArtifact { extractionHash: string; coverageHash: string; audit: ReturnType<typeof auditExtractionJobs> }
interface StoredPrinciple extends PrincipleJobResult { inputHash: string }
interface ApplicabilityArtifact { principles: { principle: PrincipleID; artifactHash: string; status: 'not-required' | 'unimplemented' | 'reviewed'; auditHash?: string; resultHash?: string }[] }
/** Missing execution is a visible outcome, never a fabricated principle result. */
export interface PrincipleOutcome {
  principle: PrincipleID
  stage: StageResult
  result: PrincipleJobResult | null
  evaluation: PrincipleJobResult['decision']['evaluation']
  finding: PrincipleJobResult['decision']['finding']
  authority: PrincipleJobResult['decision']['authority']
}

/** Isolated, private, serial orchestration. Injected adapters are trusted capabilities,
 * not a sandbox or approval. No production imports, default fetch, score algorithm,
 * automatic patch authority, or scientific certification. Native use goes through
 * runApprovedIsolatedAnalysis and the immutable OFF provider review gate. */
export async function runIsolatedAnalysis(input: IsolatedAnalysisOptions) {
  assertSource(input.source)
  const source = createSource(Buffer.from(input.source.bytes))
  const extraction = freeze(structuredClone(input.extraction)), inventory = freeze(structuredClone(input.inventory))
  const policy = input.principlePolicy.bind(input), execute = input.transport.execute.bind(input.transport)
  const applicabilityPolicy = input.applicabilityPolicy?.bind(input)
  const put = input.artifactStore.put.bind(input.artifactStore), read = input.artifactStore.read.bind(input.artifactStore)
  const evidenceHash = input.evidenceHash, policyVersion = input.policyVersion, reviewId = input.reviewId
  if (!source.bytes.length || typeof policyVersion !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(policyVersion) || !/^[a-f0-9]{64}$/.test(evidenceHash)) invalid()
  for (const [manifest, role] of [[extraction, 'extraction'], [inventory, 'inventory']] as const) {
    const eligible = manifest?.providerSlug === 'ollama'
      ? manifest.model === localRoleModel(role) && manifest.family === (role === 'extraction' ? 'gemma' : 'qwen')
      : (APPROVED_MODELS as readonly string[]).includes(manifest?.model) && manifest?.family === 'gemma'
    if (!manifest || manifest.role !== role || !eligible || !manifest.providerSlug) invalid()
  }
  async function load<T>(hash: string): Promise<T> {
    const bytes = await read(hash)
    if (!bytes || digest(bytes) !== hash) invalid()
    try { return freeze(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)) as T) } catch { return invalid() }
  }
  async function save(value: unknown) {
    const bytes = Buffer.from(JSON.stringify(value)), hash = digest(bytes)
    if (await put(bytes) !== hash || !(await read(hash))?.equals(bytes)) invalid()
    return hash
  }
  function dependency(context: StageContext, stage: StageID) {
    const result = context.dependencies.find(d => d.stage === stage)
    if (result?.status !== 'candidate' || !result.artifactHash) invalid()
    return result.artifactHash
  }
  async function executeWithinStage(ctx: StageContext, request: QualificationRequest) {
    if (ctx.signal.aborted) invalid()
    const response = await execute(request)
    // A late response cannot advance another window or audit after the fence.
    if (ctx.signal.aborted) invalid()
    return response
  }
  const persistedJob = (work: (ctx: StageContext) => Promise<unknown>, implementationVersion = 'isolated-analysis-v2'): StageJob => ({
    implementationVersion,
    async execute(ctx) { const result = await work(ctx); if (ctx.signal.aborted) invalid(); return result === null ? { status: 'unavailable' } : { status: 'candidate', artifactHash: await save(result) } },
    validate(value) { const v = value as { status?: unknown; artifactHash?: unknown }; return v?.status === 'unavailable' || (v?.status === 'candidate' && typeof v.artifactHash === 'string' && /^[a-f0-9]{64}$/.test(v.artifactHash)) },
  })
  const jobs: Partial<Record<StageID, StageJob>> = {
    extraction: persistedJob(async ctx => runExtractionJob(source, extraction, { execute: request => executeWithinStage(ctx, request) })),
    coverage: persistedJob(async ctx => {
      const extractionHash = dependency(ctx, 'extraction'), worker = await load<ExtractionJobResult>(extractionHash)
      const result = await runInventoryJob(source, inventory, { execute: request => executeWithinStage(ctx, request) })
      return { extractionHash, inventory: result, audit: auditExtractionJobs(source, worker, result) } satisfies CoverageArtifact
    }),
    'claim-audit': persistedJob(async ctx => {
      const extractionHash = dependency(ctx, 'extraction'), coverageHash = dependency(ctx, 'coverage')
      const worker = await load<ExtractionJobResult>(extractionHash), covered = await load<CoverageArtifact>(coverageHash)
      if (covered.extractionHash !== extractionHash) invalid()
      return { extractionHash, coverageHash, audit: auditExtractionJobs(source, worker, covered.inventory) } satisfies ClaimArtifact
    }),
  }
  for (const principle of PRINCIPLE_IDS) {
    const job = persistedJob(async ctx => {
      const checked = await load<ClaimArtifact>(dependency(ctx, 'claim-audit'))
      const worker = await load<ExtractionJobResult>(checked.extractionHash)
      const policyInput = freeze(structuredClone(policy(principle, source, worker.graph)))
      // Explicit unavailable policy has no model call and no invented finding.
      if (policyInput === null) return null
      if (policyInput.principle !== principle || policyInput.source.id !== source.id || policyInput.graph.id !== worker.graph.id) invalid()
      const bounded = buildPrincipleJob(policyInput)
      const inputHash = await save(policyInput)
      const request = freeze<QualificationRequest>({ tupleHash: ctx.tupleHash, attempt: 1, model: extraction.model, providerSlug: extraction.providerSlug,
        messages: bounded.messages, maxPromptTokens: extraction.maxPromptTokens, maxCompletionTokens: extraction.maxCompletionTokens, prices: extraction.prices, output: bounded.output,
        evidence: { sourceHash: source.id.slice(7), contractHash: principleRequestContractHash(policyVersion, evidenceHash, principle, bounded), role: principle }, validate: bounded.validate })
      const response = await executeWithinStage(ctx, request)
      if (response.model !== request.model || response.tupleHash !== request.tupleHash || response.attempt !== request.attempt) invalid()
      // Do not swallow transport rejection: the stage fence must retain uncertainty.
      return { ...bounded.parse(response.value), inputHash } satisfies StoredPrinciple
    })
    jobs[principle] = {
      ...job,
      async execute(ctx) {
        const checked = await load<ClaimArtifact>(dependency(ctx, 'claim-audit'))
        const worker = await load<ExtractionJobResult>(checked.extractionHash)
        // Disjoint extraction windows do not establish cross-window semantics.
        if (!checked.audit.claims.valid || !checked.audit.coverage.coverageComplete || worker.receipts.length !== 1) return { status: 'unavailable' }
        return job.execute(ctx)
      },
      validate(value) { return (value as { status?: unknown })?.status === 'unavailable' || job.validate(value) },
    }
  }
  jobs.applicability = persistedJob(async ctx => {
    const principles: ApplicabilityArtifact['principles'] = []
    for (const principle of PRINCIPLE_IDS) {
      const artifactHash = dependency(ctx, principle), worker = await load<StoredPrinciple>(artifactHash)
      if (!worker.candidate) { principles.push({ principle, artifactHash, status: 'not-required' }); continue }
      const policyInput = await load<PrincipleJobInput>(worker.inputHash)
      const context = applicabilityPolicy?.(policyInput, worker)
      if (!context) { principles.push({ principle, artifactHash, status: 'unimplemented' }); continue }
      const trusted = freeze(structuredClone(context))
      const bounded = buildApplicabilityJob(policyInput, worker, trusted)
      const request = freeze<QualificationRequest>({ tupleHash: digest(ctx.tupleHash + principle + JSON.stringify(bounded.messages)), attempt: 1,
        model: inventory.model, providerSlug: inventory.providerSlug, messages: bounded.messages,
        maxPromptTokens: inventory.maxPromptTokens, maxCompletionTokens: inventory.maxCompletionTokens,
        prices: inventory.prices, output: bounded.output,
        evidence: { sourceHash: source.id.slice(7), role: 'applicability-' + principle, contractHash: digest(JSON.stringify({ version: 'isolated-analysis-v2', policyVersion, evidenceHash, principle, output: bounded.output, instructions: bounded.messages[0].content })) }, validate: bounded.validate })
      const response = await executeWithinStage(ctx, request)
      if (response.model !== request.model || response.tupleHash !== request.tupleHash || response.attempt !== request.attempt) invalid()
      const parsed = bounded.parse(response.value)
      const reference = parsed.result.auditReference
      if (reference) {
        // Persist the exact evidence.ts commitment, not just a differently hashed
        // wrapper. References must resolve before a result containing them is saved.
        const contextCommitment = { actorID: trusted.actorID, role: trusted.role, sourceHash: trusted.sourceHash,
          graphHash: trusted.graphHash, policy: trusted.policy, registeredClaimIDs: trusted.registeredClaimIDs,
          registeredEvidence: trusted.registeredEvidence.map(r => ({ id: r.id, recordHash: r.recordHash })) }
        const commitment = JSON.parse(serializeEvidenceArtifact({ audit: parsed.audit, contextCommitment }))
        if (digest(JSON.stringify(commitment)) !== reference.auditHash || digest(serializeEvidenceArtifact(contextCommitment)) !== reference.contextHash ||
          digest(serializeEvidenceArtifact(parsed.audit.assessments)) !== reference.assessmentHash) invalid()
        if (await save(commitment) !== reference.auditHash) invalid()
      }
      const auditHash = await save({ ...parsed, context: trusted, inputHash: worker.inputHash })
      // The independent result, not the worker's request, owns final edit authority.
      // A rejected executable change does not discard advisory-only design work.
      const humanDesign = worker.decision.authority === 'requires-human-design'
      const approved = parsed.result.approvedDraftEdit
      const decision = createDecision({ ...worker.decision,
        finding: approved ? 'supported' : humanDesign ? worker.decision.finding : parsed.audit.verdict === 'reject' ? 'rejected' : 'insufficient',
        authority: approved ? 'approved-draft-edit' : humanDesign ? 'requires-human-design' : 'no-edit',
        reasons: { version: '1.0.0', codes: parsed.result.reasons },
        auditReference: parsed.result.auditReference,
      })
      const resultHash = await save({ ...worker, decision })
      principles.push({ principle, artifactHash, status: 'reviewed', auditHash, resultHash })
    }
    return { principles } satisfies ApplicabilityArtifact
  }, 'isolated-applicability-v3')
  jobs.assembly = persistedJob(async ctx => {
    const applicability = await load<ApplicabilityArtifact>(dependency(ctx, 'applicability'))
    const principles: PrincipleJobResult[] = []
    for (const row of applicability.principles) principles.push(await load<PrincipleJobResult>(row.resultHash ?? row.artifactHash))
    return { source, principles, applicability, summary: summarizeDecisions(principles.map(p => p.decision)), applied: false, scoring: 'unimplemented', scientificReview: 'pending' }
  })
  const roles = Object.freeze(Object.fromEntries(STAGES.map(stage => {
    const m = stage.id === 'coverage' || stage.id === 'applicability' ? inventory : extraction
    return [stage.id, Object.freeze({ family: m.family === 'qwen' ? 'Qwen' as const : 'Gemma' as const, model: m.model, modelVersion: m.id, roleVersion: policyVersion, transportVersion: m.providerSlug! })]
  })))
  const run = await runStages({ binding: { sourceId: source.id, sourceVersion: 'raw-v1', evidenceHash,
    evidenceVersion: policyVersion, contractVersion: digest(JSON.stringify({ version: 'isolated-analysis-v2', extraction, inventory, policyVersion, evidenceHash, ...(input.localTransportTimeoutMs === undefined ? {} : { localTransportTimeoutMs: input.localTransportTimeoutMs }) })) },
    config: Object.freeze({ reviewId, roles }), jobs, store: input.stageStore, timeoutMs: input.timeoutMs })
  const principles: PrincipleJobResult[] = []
  const principleOutcomes: PrincipleOutcome[] = []
  const applicabilityStage = run.stages.find(s => s.stage === 'applicability')
  const finalized = applicabilityStage?.status === 'candidate' && applicabilityStage.artifactHash
    ? await load<ApplicabilityArtifact>(applicabilityStage.artifactHash) : null
  for (const principle of PRINCIPLE_IDS) {
    const row = run.stages.find(s => s.stage === principle)
    if (!row) invalid()
    const reviewedHash = finalized?.principles.find(p => p.principle === principle)?.resultHash
    const result = row.artifactHash ? await load<PrincipleJobResult>(reviewedHash ?? row.artifactHash) : null
    if (result) principles.push(result)
    principleOutcomes.push({ principle, stage: row, result,
      evaluation: result?.decision.evaluation ?? (row.status === 'failed' ? 'error' : 'not-evaluated'),
      finding: result?.decision.finding ?? 'unavailable', authority: result?.decision.authority ?? 'no-edit' })
  }
  const principleOutcomeSummary = { total: principleOutcomes.length, withResult: principles.length,
    withoutResult: principleOutcomes.length - principles.length, safetyCertified: false }
  const artifactHash = await save({ version: 'isolated-analysis/v2', source, stages: run.stages, principles, principleOutcomes, principleOutcomeSummary,
    summary: summarizeDecisions(principles.map(p => p.decision)), scientificReview: 'pending', ready: false })
  // Only hashes and closed stage states leave the private artifact boundary.
  return Object.freeze({ ...run, artifactHash })
}

/** This entrypoint cannot acquire storage or inference until provider reviews pass.
 * It does not accept a caller-supplied transport or private-root override. */
export async function runApprovedIsolatedAnalysis(input: Omit<IsolatedAnalysisOptions, 'transport' | 'stageStore' | 'artifactStore'>, approval: { approvalToken: string; mission: Mission }) {
  const transport = createProvider(approval)
  return runIsolatedAnalysis({ ...input, transport, stageStore: createStageStore(), artifactStore: createArtifactStore() })
}

/** Operator-authorized local-only entrypoint; never changes hosted LIVE_APPROVAL.
 * Source and per-role schema contract hashes must be pinned before execution.
 */
export async function runAuthorizedLocalIsolatedAnalysis(input: Omit<IsolatedAnalysisOptions, 'transport' | 'stageStore' | 'artifactStore'>, authorization: LocalAuthorization) {
  const stageStore = createStageStore(), artifactStore = createArtifactStore()
  const transport = createLocalQualificationTransport({ authorization, stageStore: createLocalTransportStore(), artifactStore, timeoutMs: input.localTransportTimeoutMs ?? Math.min(input.timeoutMs, 55_000) })
  if (input.reviewId !== authorization.reviewId || !authorization.sourceHashes.includes(input.source.id.slice(7)) ||
      input.extraction.providerSlug !== 'ollama' || input.inventory.providerSlug !== 'ollama') invalid()
  return runIsolatedAnalysis({ ...input, transport, stageStore, artifactStore })
}
