import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as stages from '../../../lib/local-qualification/stages'
import { runIsolatedAnalysis } from '../../../lib/local-qualification/analysis'
import { prepareLocalAnalysis } from '../../../lib/local-qualification/local-analysis-options'
import { acknowledgeLocalTimeout } from '../../../lib/local-qualification/local-transport'
import { createTestStageStore, createTestArtifactStore } from '../../../lib/local-qualification/stage-store'
import { createSource } from '../../../lib/local-qualification/source'
import { digest } from '../../../lib/local-qualification/manifests'
const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
async function fixture(target: 'extraction' | 'coverage' = 'extraction', fault?: 'contract' | 'role-model') {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'stage-recovery-synthetic-')); roots.push(root)
  const stageStore = createTestStageStore({ root, synthetic: true })
  const transportStore = createTestStageStore({ root: join(root, 'transport'), synthetic: true })
  const artifactStore = createTestArtifactStore({ root, synthetic: true })
  const { options: analysis } = prepareLocalAnalysis(createSource('Stir the synthetic mixture.'), 'synthetic-old')
  analysis.timeoutMs = 60_000
  analysis.extraction = { ...analysis.extraction, id: 'local-full-source-v1-extraction' }
  analysis.inventory = { ...analysis.inventory, id: 'local-full-source-v1-inventory' }
  delete analysis.localTransportTimeoutMs
  const transport = { execute: vi.fn(async (request: import('../../../lib/local-qualification/provider').QualificationRequest) => {
    if (target === 'coverage' && request.evidence?.role === 'extraction') {
      const { sourceWindow: a } = JSON.parse(request.messages[1].content)
      const anchor = { start: a.start, end: a.end, quote: a.quote }
      return { model: request.model, tupleHash: request.tupleHash, attempt: request.attempt, value: {
        candidates: [{ category: 'operation', status: 'observed', value: a.quote, anchor }], edges: [],
        dispositions: [{ anchor, kind: 'facts', candidateIndices: [0], reason: null }],
      } }
    }
    const { validate: _validate, ...data } = request
    const evidence = { ...request.evidence }
    let model = request.model
    if (fault === 'contract') evidence.contractHash = digest('unrelated-contract')
    if (fault === 'role-model') {
      evidence.role = target === 'extraction' ? 'inventory' : 'extraction'
      model = target === 'extraction' ? analysis.inventory.model : analysis.extraction.model
    }
    const start = JSON.stringify({ tupleHash: request.tupleHash, requestHash: digest(JSON.stringify(data)), authorizationHash: digest('synthetic'), evidence, model, attempt: 1 })
    await transportStore.append('local-transport/0/start', start)
    await transportStore.append('local-transport/0/result', JSON.stringify({ startHash: digest(start), status: 'error', code: 'TIMEOUT', rawHash: await artifactStore.put(Buffer.from('')), telemetry: null }))
    throw new Error('LOCAL_TIMEOUT')
  }) }
  const run = await runIsolatedAnalysis({ ...analysis, stageStore, artifactStore, transport })
  expect(run.stages.find(s => s.stage === target)?.code).toBe('JOB_FAILED')
  const tupleHash = run.stages.find(s => s.stage === target)!.tupleHash
  const stageKey = `${run.runId}/${target}/${tupleHash}/1`
  const result = (await stageStore.read(stageKey + '/result'))!
  const transportResult = (await transportStore.read('local-transport/0/result'))!
  const fetch = vi.fn(async () => new Response('{"models":[]}'))
  const recover = { stageStore, transportStore, artifactStore, analysis, runId: run.runId, stage: target, fenceIndex: target === 'extraction' ? 0 : 1, transportIndex: 0, expectedStageResultHash: digest(result), expectedTransportResultHash: digest(transportResult), operator: 'synthetic-operator' }
  const acknowledge = () => acknowledgeLocalTimeout({ stageStore: transportStore, artifactStore, index: 0, expectedResultHash: digest(transportResult), operator: recover.operator, fetch })
  return { ...recover, recover, acknowledge, fetch, transport, result, stageKey, tupleHash }
}
it('exports explicit local stage-fence recovery', () => expect(stages.acknowledgeLocalStageTimeout).toBeTypeOf('function'))
it.each([['extraction', 'contract'], ['extraction', 'role-model'], ['coverage', 'contract'], ['coverage', 'role-model']] as const)('rejects contradictory %s receipt %s despite matching request hashes', async (target, fault) => {
    const f = await fixture(target, fault)
    await f.acknowledge()
    expect(await f.transportStore.read('local-transport/0/recovery')).not.toBeNull()
    await expect(stages.acknowledgeLocalStageTimeout(f.recover)).rejects.toThrow('STAGE_RECOVERY_MISMATCH')
    expect(await f.stageStore.read(`execution-fence/${f.recover.fenceIndex}/recovery`)).toBeNull()
    expect(await f.stageStore.read(f.stageKey + '/result')).toBe(f.result)
})
it('still recovers a correctly bound coverage receipt', async () => {
  const f = await fixture('coverage')
  await f.acknowledge()
  await stages.acknowledgeLocalStageTimeout(f.recover)
  expect(await f.stageStore.read('execution-fence/1/recovery')).not.toBeNull()
})
it('recovers only acknowledged exact receipts, preserving originals and never replaying failed tuples', async () => {
  const f = await fixture()
  await f.acknowledge()
  await stages.acknowledgeLocalStageTimeout(f.recover)
  expect(await f.stageStore.read(f.stageKey + '/result')).toBe(f.result)
  expect(await f.stageStore.read('execution-fence/0/start')).toBe(f.tupleHash)
  expect(await f.stageStore.read('execution-fence/0/settled')).toBeNull()
  expect(await f.stageStore.read('execution-fence/0/recovery')).not.toBeNull()
  await expect(stages.acknowledgeLocalStageTimeout(f.recover)).rejects.toThrow('STAGE_RECOVERY_EXISTS')
  const old = await runIsolatedAnalysis({ ...f.analysis, stageStore: f.stageStore, artifactStore: f.artifactStore, transport: f.transport })
  expect(old.stages[0].code).toBe('JOB_FAILED')
  expect(f.transport.execute).toHaveBeenCalledTimes(1)
  const relabeled = await runIsolatedAnalysis({ ...f.analysis, reviewId: 'label-only', stageStore: f.stageStore, artifactStore: f.artifactStore, transport: f.transport })
  expect(relabeled.stages.every(s => s.code === 'RUN_HALTED')).toBe(true)
  expect(f.transport.execute).toHaveBeenCalledTimes(1)
  const next = prepareLocalAnalysis(f.analysis.source, 'synthetic-new').options
  const execute = vi.fn(async () => { throw new Error('synthetic next failure') })
  const changed = await runIsolatedAnalysis({ ...next, stageStore: f.stageStore, artifactStore: f.artifactStore, transport: { execute } })
  expect(changed.runId).not.toBe(f.runId)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(await f.stageStore.read(f.stageKey + '/result')).toBe(f.result)
})
it.each(['unacknowledged', 'stage-hash', 'transport-hash', 'wrong-source', 'wrong-contract', 'unknown-cancellation', 'unsettled', 'wrong-fence'])('refuses %s without writing recovery', async fault => {
  const f = await fixture()
  if (fault !== 'unacknowledged') await f.acknowledge()
  if (fault === 'stage-hash') f.recover.expectedStageResultHash = '0'.repeat(64)
  if (fault === 'transport-hash') f.recover.expectedTransportResultHash = '0'.repeat(64)
  if (fault === 'wrong-source') f.analysis.source = createSource('Different synthetic source.')
  if (fault === 'wrong-contract') f.analysis.extraction = { ...f.analysis.extraction, id: 'unrelated' }
  if (fault === 'wrong-fence') f.recover.fenceIndex = 1
  const read = f.transportStore.read.bind(f.transportStore)
  if (fault === 'unknown-cancellation') f.transportStore.read = async key => key.endsWith('/recovery') ? '{}' : read(key)
  if (fault === 'unsettled') f.transportStore.read = async key => key.endsWith('/result') ? null : read(key)
  await expect(stages.acknowledgeLocalStageTimeout(f.recover)).rejects.toThrow()
  expect(await f.stageStore.read('execution-fence/0/recovery')).toBeNull()
})
