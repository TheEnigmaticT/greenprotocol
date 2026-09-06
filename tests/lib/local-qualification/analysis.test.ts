import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSource } from '../../../lib/local-qualification/source'
import { createTestStageStore, createTestArtifactStore } from '../../../lib/local-qualification/stage-store'
import { PRINCIPLE_IDS, PRINCIPLES } from '../../../lib/local-qualification/principles'
import type { QualificationRequest } from '../../../lib/local-qualification/provider'
import type { ExtractionJobManifest } from '../../../lib/local-qualification/extraction-jobs'
import type { PrincipleJobInput } from '../../../lib/local-qualification/principle-jobs'
import { contentHash, createEvidenceRecord, SUPPORT_KINDS } from '../../../lib/local-qualification/evidence'
const api = await import('../../../lib/local-qualification/analysis').catch(() => ({})) as typeof import('../../../lib/local-qualification/analysis')
const roots: string[] = []
const model = 'google/gemma-4-31b-it'
const text = 'Stir the documented mixture. Composition is unreported.'
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'analysis-synthetic-')); roots.push(root)
  const source = createSource(text), calls: QualificationRequest[] = []
  const manifest = (role: 'extraction' | 'inventory'): ExtractionJobManifest => ({ id: 'synthetic-' + role, role, family: 'gemma', model, providerSlug: 'deepinfra/turbo', outputKind: 'json_schema', maxSourceBytes: 65536, maxPromptTokens: 262144, maxCompletionTokens: 4000, prices: { prompt: 1, completion: 2, request: 0 }, attempt: 1 })
  const stages = createTestStageStore({ root, synthetic: true }), artifacts = createTestArtifactStore({ root, synthetic: true })
  const execute = vi.fn(async (request: QualificationRequest) => {
    calls.push(request)
    let value: unknown
    const data = JSON.parse(request.messages[1].content)
    if (data.sourceWindow) {
      const a = data.sourceWindow
      const candidates = [{ category: 'operation', status: 'observed', value: a.quote, anchor: { start: a.start, end: a.end, quote: a.quote } }]
      value = { candidates, dispositions: [{ anchor: candidates[0].anchor, kind: 'facts', candidateIndices: [0], reason: null }], ...(data.roleManifest.role === 'extraction' ? { edges: [] } : {}) }
    } else {
      const principle = request.output.schema.properties as Record<string, { enum: string[] }>
      const id = principle.principle.enum[0] as typeof PRINCIPLE_IDS[number]
      value = { version: '1.0.0', principle: id, sourceHash: data.sourceHash, graphHash: data.graphHash,
        finding: 'unresolved', action: 'investigate', proposal: null,
        checks: PRINCIPLES[id].requiredDependencies.map(key => ({ key, status: 'unknown', factIDs: [], evidenceIDs: [] })),
        findings: [{ principle: id, topic: PRINCIPLES[id].requiredDependencies[0], status: 'unknown', factIDs: data.factIDs, evidenceIDs: [], interpretation: 'The documented mixture has unreported composition.', constraint: 'Composition-dependent conclusions remain unresolved.', nextAction: 'Obtain the missing mixture composition for this occurrence.' }] }
    }
    return { value, model: request.model, tupleHash: request.tupleHash, attempt: request.attempt }
  })
  const options: Parameters<typeof api.runIsolatedAnalysis>[0] = {
    source, extraction: manifest('extraction'), inventory: manifest('inventory'),
    reviewId: 'synthetic-review-not-independent', policyVersion: 'synthetic-v1', evidenceHash: 'a'.repeat(64),
    stageStore: stages, artifactStore: artifacts, timeoutMs: 1000,
    transport: { execute },
    principlePolicy: (principle, s, graph) => ({ principle, source: s, graph, category: PRINCIPLES[principle].eligibleCategories[0], workerID: 'synthetic-worker', factIDs: graph.facts.map(f => f.id), dependencyFacts: {}, evidence: { approvalID: 'synthetic-evidence', snapshots: [], records: [] } } satisfies PrincipleJobInput),
  }
  return { options, calls, execute, artifacts }
}
afterEach(() => { vi.restoreAllMocks(); roots.forEach(root => rmSync(root, { recursive: true, force: true })); roots.length = 0 })
describe('isolated analysis integration with synthetic transport, not scientific qualification', () => {
  it('exports an actual isolated orchestrator and approval-gated native entrypoint', () => {
    expect(api.runIsolatedAnalysis).toBeTypeOf('function')
    expect(api.runApprovedIsolatedAnalysis).toBeTypeOf('function')
  })
  it('pins applicability stage identity to the auditor transport rather than the worker transport', async () => {
    const { options } = fixture()
    options.inventory = { ...options.inventory, providerSlug: 'coreweave/fp4' }
    const result = await api.runIsolatedAnalysis(options)
    const manifest = JSON.parse((await options.stageStore.read(result.runId + '/manifest'))!)
    expect(manifest.roles.applicability.transportVersion).toBe('coreweave/fp4')
    expect(manifest.roles.P5.transportVersion).toBe('deepinfra/turbo')
  })
  it('wires extraction, independent inventory, all twelve jobs, assembly and private reload without network or false safety', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'))
    const { options, calls, artifacts } = fixture()
    const first = await api.runIsolatedAnalysis(options)
    expect(calls).toHaveLength(2 + PRINCIPLE_IDS.length)
    expect(calls.every(r => r.model === model && r.providerSlug === 'deepinfra/turbo')).toBe(true)
    expect(new Set(calls.map(r => r.tupleHash)).size).toBe(calls.length)
    const saved = JSON.parse((await artifacts.read(first.artifactHash))!.toString('utf8'))
    expect(saved.source.text).toBe(text)
    expect(saved.principles.map((r: { decision: { principle: string } }) => r.decision.principle)).toEqual(PRINCIPLE_IDS)
    expect(saved.principles.every((r: { findings: unknown[] }) => r.findings.length === 1)).toBe(true)
    expect(saved.principles[3].decision.principle).toBe('P4')
    expect(saved.summary.allTwelveEvaluatedNoIssue).toBe(false)
    expect(first.ready).toBe(false)
    expect(first.stages.find(s => s.stage === 'rescore')?.status).toBe('unimplemented')
    expect(first.stages.find(s => s.stage === 'acceptance')?.status).toBe('blocked')
    expect(JSON.stringify(first)).not.toContain(text)
    const second = await api.runIsolatedAnalysis(options)
    expect(second).toEqual(first)
    expect(calls).toHaveLength(2 + PRINCIPLE_IDS.length)
    expect(network).not.toHaveBeenCalled()
  })
  it('retains a private stage failure and halts before sibling principles or retries', async () => {
    const { options, execute, calls, artifacts } = fixture()
    const original = execute.getMockImplementation()!
    execute.mockImplementation(async r => { if (r.output.name.includes('P1')) throw new Error('PRIVATE-SENTINEL uncertain provider'); return original(r) })
    const result = await api.runIsolatedAnalysis(options)
    expect(result.stages.find(s => s.stage === 'P1')?.code).toBe('JOB_FAILED')
    expect(result.stages.find(s => s.stage === 'P2')?.code).toBe('RUN_HALTED')
    expect(JSON.stringify(result)).not.toContain('PRIVATE-SENTINEL')
    const saved = JSON.parse((await artifacts.read(result.artifactHash))!.toString('utf8'))
    expect(saved.principles).toHaveLength(0)
    const count = calls.length
    await api.runIsolatedAnalysis(options)
    expect(calls).toHaveLength(count)
  })
  it('cannot launch another extraction window after a stage deadline and late uncancelled response', async () => {
    const { options, execute } = fixture()
    options.timeoutMs = 5
    options.extraction = { ...options.extraction, maxSourceBytes: 10 }
    const original = execute.getMockImplementation()!
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    execute.mockImplementation(async r => { await pending; return original(r) })
    const result = await api.runIsolatedAnalysis(options)
    expect(result.stages[0].code).toBe('DEADLINE')
    release()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('blocks principle inference when worker and independent source inventory disagree', async () => {
    const { options, execute, calls } = fixture()
    const original = execute.getMockImplementation()!
    execute.mockImplementation(async r => {
      const response = await original(r)
      if (r.evidence?.role === 'inventory') {
        const value = response.value as { candidates: { category: string }[] }
        value.candidates[0].category = 'mixture'
      }
      return response
    })
    const result = await api.runIsolatedAnalysis(options)
    expect(calls).toHaveLength(2)
    expect(result.stages.find(s => s.stage === 'P1')?.status).toBe('unavailable')
    expect(result.ready).toBe(false)
  })
  it('rejects mismatched trusted policy source before any principle inference', async () => {
    const { options, calls } = fixture()
    const policy = options.principlePolicy
    options.principlePolicy = (p, s, g) => ({ ...policy(p, s, g)!, source: createSource('different source') })
    const result = await api.runIsolatedAnalysis(options)
    expect(calls).toHaveLength(2)
    expect(result.stages.find(s => s.stage === 'P1')?.code).toBe('JOB_FAILED')
  })
  it.each(['extraction', 'P5', 'inventory-disagreement'] as const)('persists all twelve explicit outcomes after %s without inventing findings', async fault => {
    const { options, execute, artifacts, calls } = fixture()
    const original = execute.getMockImplementation()!
    execute.mockImplementation(async request => {
      if (request.evidence?.role === fault) throw new Error('PRIVATE-SENTINEL failure')
      const response = await original(request)
      if (fault === 'inventory-disagreement' && request.evidence?.role === 'inventory') {
        (response.value as { candidates: { category: string }[] }).candidates[0].category = 'mixture'
      }
      return response
    })
    const result = await api.runIsolatedAnalysis(options)
    const saved = JSON.parse((await artifacts.read(result.artifactHash))!.toString('utf8'))
    expect(saved.principleOutcomes?.map((row: { principle: string }) => row.principle)).toEqual(PRINCIPLE_IDS)
    expect(saved.principleOutcomeSummary).toEqual({ total: 12, withResult: fault === 'P5' ? 4 : 0, withoutResult: fault === 'P5' ? 8 : 12, safetyCertified: false })
    for (const row of saved.principleOutcomes) {
      const stage = result.stages.find(s => s.stage === row.principle)!
      expect(row.stage).toEqual(stage)
      if (stage.status === 'candidate') {
        expect(row.result).toEqual(JSON.parse((await artifacts.read(stage.artifactHash!))!.toString('utf8')))
      } else {
        expect(row.result).toBeNull()
        expect(row.evaluation).toBe(stage.status === 'failed' ? 'error' : 'not-evaluated')
        expect(row.finding).toBe('unavailable')
        expect(row.authority).toBe('no-edit')
      }
    }
    expect(saved.summary.allTwelveEvaluatedNoIssue).toBe(false)
    expect(JSON.stringify(result)).not.toContain('PRIVATE-SENTINEL')
    const count = calls.length
    const resumed = await api.runIsolatedAnalysis(options)
    expect(resumed).toEqual(result)
    expect(calls).toHaveLength(count)
  })
  it('supports exact local worker/auditor roles and skips explicitly unavailable principles without inference', async () => {
    const { OLLAMA_PILOT_MODELS } = await import('../../../lib/decomposed-benchmark/ollama-provider')
    const { options, calls, artifacts } = fixture()
    options.extraction = { ...options.extraction, model: OLLAMA_PILOT_MODELS[0], family: 'gemma', providerSlug: 'ollama' }
    options.inventory = { ...options.inventory, model: OLLAMA_PILOT_MODELS[1], family: 'qwen', providerSlug: 'ollama' }
    options.principlePolicy = () => null
    const result = await api.runIsolatedAnalysis(options)
    expect(calls.map(c => c.model)).toEqual([...OLLAMA_PILOT_MODELS])
    const manifest = JSON.parse((await options.stageStore.read(result.runId + '/manifest'))!)
    expect(manifest.roles.coverage.family).toBe('Qwen')
    expect(manifest.roles.applicability.model).toBe(OLLAMA_PILOT_MODELS[1])
    const saved = JSON.parse((await artifacts.read(result.artifactHash))!.toString())
    expect(saved.principleOutcomes).toHaveLength(12)
    expect(saved.principleOutcomes.every((p: { finding: string; evaluation: string; authority: string }) => p.finding === 'unavailable' && p.evaluation === 'not-evaluated' && p.authority === 'no-edit')).toBe(true)
  })
  it('runs the LOCAL native entrypoint through the reused adapter and separate durable lock domains', async () => {
    const { OLLAMA_PILOT_MODELS } = await import('../../../lib/decomposed-benchmark/ollama-provider')
    const stores = await import('../../../lib/local-qualification/stage-store')
    const dry = fixture()
    const localize = (options: typeof dry.options) => {
      options.extraction = { ...options.extraction, model: OLLAMA_PILOT_MODELS[0], family: 'gemma', providerSlug: 'ollama', maxPromptTokens: 14336, maxCompletionTokens: 2048, prices: { prompt: 0, completion: 0, request: 0 } }
      options.inventory = { ...options.inventory, model: OLLAMA_PILOT_MODELS[1], family: 'qwen', providerSlug: 'ollama', maxPromptTokens: 14336, maxCompletionTokens: 2048, prices: { prompt: 0, completion: 0, request: 0 } }
      options.principlePolicy = () => null
    }
    localize(dry.options)
    await api.runIsolatedAnalysis(dry.options)
    const real = fixture(), separate = fixture(); localize(real.options)
    vi.spyOn(stores, 'createStageStore').mockReturnValue(real.options.stageStore)
    vi.spyOn(stores, 'createArtifactStore').mockReturnValue(real.artifacts)
    vi.spyOn(stores, 'createLocalTransportStore').mockReturnValue(separate.options.stageStore)
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string)
      const role = JSON.parse(body.messages[1].content).roleManifest.role
      const request = dry.calls.find(c => c.evidence!.role === role)!
      const response = await dry.execute(request)
      return new Response(JSON.stringify({ model: body.model, done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(response.value) }, prompt_eval_count: 20, eval_count: 10 }))
    })
    real.options.timeoutMs = 240_000
    real.options.localTransportTimeoutMs = 180_000
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const result = await api.runAuthorizedLocalIsolatedAnalysis(real.options, { mode: 'LOCAL', authorized: true, reviewId: real.options.reviewId, sourceHashes: [real.options.source.id.slice(7)], roleContracts: Object.fromEntries(dry.calls.map(c => [c.evidence!.role, c.evidence!.contractHash])) })
    expect(timers.mock.calls.map(c => c[1])).toContain(180_000)
    expect(timers.mock.calls.map(c => c[1])).toContain(240_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.stages[0].status).toBe('candidate')
    expect(result.stages[1].status).toBe('candidate')
    expect(result.ready).toBe(false)
  })
  it('native entrypoint remains OFF before source access, storage or credential consumption', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'))
    await expect(api.runApprovedIsolatedAnalysis({} as never, { approvalToken: 'not-approved', mission: { id: 'original-sprint', sourceEvidence: ['a'.repeat(64)], contractHash: 'b'.repeat(64), roleModels: { extraction: model } } })).rejects.toThrow('LIVE_NOT_APPROVED')
    expect(network).not.toHaveBeenCalled()
  })
  it.each(['approve', 'reject'] as const)('runs and privately persists a resolvable %s applicability audit for a synthetic supported P5 candidate', async verdict => {
    const { options, execute, artifacts, calls } = fixture()
    const originalPolicy = options.principlePolicy
    options.principlePolicy = (p, s, g) => {
      const input = originalPolicy(p, s, g)!
      if (p !== 'P5') return input
      const content = 'Synthetic four-kind support; not chemical evidence.'
      const snapshot = { id: 'synthetic-snapshot', version: 'v1', content, contentHash: contentHash(content) }
      const records = SUPPORT_KINDS.map((supportKind, i) => createEvidenceRecord(snapshot, {
        id: 'evidence-' + i, version: '1.0.0', sourceHash: snapshot.contentHash, sourceVersion: snapshot.version,
        locator: { sourceID: snapshot.id, start: 0, end: content.length }, excerpt: content,
        status: 'verified', contradictions: [], limitations: [], claimIDs: input.factIDs,
        supportKind, subjectID: supportKind === 'original-hazard' ? input.factIDs[0] : 'synthetic-alternative', conditionsHash: contentHash('synthetic-conditions'),
      }))
      return { ...input, dependencyFacts: Object.fromEntries(PRINCIPLES.P5.requiredDependencies.map(k => [k, input.factIDs])), evidence: { approvalID: 'synthetic-evidence', snapshots: [snapshot], records } }
    }
    options.applicabilityPolicy = (input, worker) => ({ actorID: 'separate-synthetic-auditor', role: 'applicability-auditor', sourceHash: worker.decision.sourceHash, graphHash: worker.decision.graphHash,
      registeredClaimIDs: input.factIDs, registeredEvidence: input.evidence.records,
      policy: { candidateHash: worker.packet!.candidateHash, principle: input.principle, contractVersion: worker.candidate!.contractVersion, changeClass: worker.candidate!.changeClass } })
    const originalExecute = execute.getMockImplementation()!
    execute.mockImplementation(async request => {
      const data = JSON.parse(request.messages[1].content)
      if (request.output.name.startsWith('applicability_')) {
        calls.push(request)
        expect(data).not.toHaveProperty('finding')
        expect(data).not.toHaveProperty('requestedAuthority')
        const value = { version: '1.0.0', candidateHash: data.candidateHash, graphHash: data.graphHash, packetHash: data.packetHash, verdict,
          assessments: data.requiredPairs.map((pair: object) => ({ ...pair, applicable: true, factIDs: data.factIDs })) }
        return { value, model: request.model, tupleHash: request.tupleHash, attempt: request.attempt }
      }
      const response = await originalExecute(request)
      if (request.output.name.includes('P5')) Object.assign(response.value as object, {
        finding: 'supported', action: 'compare',
        checks: PRINCIPLES.P5.requiredDependencies.map(key => ({ key, status: 'known', factIDs: data.factIDs, evidenceIDs: data.evidence.records.map((r: { id: string }) => r.id) })),
        findings: [{ principle: 'P5', topic: PRINCIPLES.P5.requiredDependencies[0], status: 'observation', factIDs: data.factIDs, evidenceIDs: [], interpretation: 'Synthetic source occurrence.', constraint: 'Synthetic support is not chemistry validation.', nextAction: 'Independent review required.' }],
        proposal: { originalSubjectID: data.factIDs[0], alternativeSubjectID: 'synthetic-alternative', conditionsHash: contentHash('synthetic-conditions'), changeClass: 'bounded-substitution' },
      })
      return response
    })
    const result = await api.runIsolatedAnalysis(options)
    const row = result.stages.find(s => s.stage === 'applicability')!
    const applicability = JSON.parse((await artifacts.read(row.artifactHash!))!.toString('utf8'))
    const p5 = applicability.principles.find((p: { principle: string }) => p.principle === 'P5')
    expect(p5.status).toBe('reviewed')
    const audit = JSON.parse((await artifacts.read(p5.auditHash))!.toString('utf8'))
    expect(audit.result.approvedDraftEdit).toBe(verdict === 'approve')
    const final = JSON.parse((await artifacts.read(result.artifactHash))!.toString('utf8'))
    const finalP5 = final.principleOutcomes.find((p: { principle: string }) => p.principle === 'P5')
    expect(finalP5.finding).toBe(verdict === 'approve' ? 'supported' : 'rejected')
    expect(finalP5.authority).toBe(verdict === 'approve' ? 'approved-draft-edit' : 'no-edit')
    expect(finalP5.result.decision.auditReference).toEqual(audit.result.auditReference)
    const assemblyRow = result.stages.find(s => s.stage === 'assembly')!
    const assembly = JSON.parse((await artifacts.read(assemblyRow.artifactHash!))!.toString('utf8'))
    expect(assembly.principles.find((p: { decision: { principle: string } }) => p.decision.principle === 'P5').decision).toEqual(finalP5.result.decision)
    expect(assembly.applied).toBe(false)
    const reference = audit.result.auditReference
    const committedBytes = await artifacts.read(reference.auditHash)
    expect(committedBytes, 'durable audit reference must resolve, not point only to a different wrapper hash').not.toBeNull()
    const committed = JSON.parse(committedBytes!.toString('utf8'))
    expect(committed.audit).toEqual(audit.audit)
    expect(contentHash(JSON.stringify(committed))).toBe(reference.auditHash)
    expect(contentHash(JSON.stringify(committed.contextCommitment))).toBe(reference.contextHash)
    expect(contentHash(JSON.stringify(committed.audit.assessments))).toBe(reference.assessmentHash)
    expect(committed.contextCommitment.registeredEvidence).toEqual(audit.context.registeredEvidence.map((r: { id: string; recordHash: string }) => ({ id: r.id, recordHash: r.recordHash })))
    expect(audit.grounding.auditorID).toBe('separate-synthetic-auditor')
    expect(audit.grounding.assessments).toHaveLength(4)
    expect(calls.filter(r => r.output.name.startsWith('applicability_'))).toHaveLength(1)
    expect(result.ready).toBe(false)
  })
})
