import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as api from '../../../lib/local-qualification/local-transport'
import { createTestStageStore, createTestArtifactStore } from '../../../lib/local-qualification/stage-store'
import { digest } from '../../../lib/local-qualification/manifests'
import { runStages } from '../../../lib/local-qualification/stages'
const roots: string[] = []
afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }) })
async function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'recovery-synthetic-')); roots.push(root)
  const stageStore = createTestStageStore({ root, synthetic: true }), artifactStore = createTestArtifactStore({ root, synthetic: true })
  const start = JSON.stringify({ tupleHash: 'a'.repeat(64), requestHash: 'b'.repeat(64), authorizationHash: 'c'.repeat(64), evidence: { role: 'extraction', sourceHash: 'd'.repeat(64), contractHash: 'e'.repeat(64) }, model: api.localRoleModel('extraction'), attempt: 1 })
  const result = JSON.stringify({ startHash: digest(start), status: 'error', code: 'TIMEOUT', rawHash: await artifactStore.put(Buffer.from('')), telemetry: null })
  await stageStore.append('local-transport/0/start', start)
  await stageStore.append('local-transport/0/result', result)
  return { stageStore, artifactStore, start, result, index: 0, expectedResultHash: digest(result), operator: 'test-operator', fetch: vi.fn(async () => new Response('{"models":[]}')) }
}
it('exports operator-only timeout acknowledgment', () => { expect(api.acknowledgeLocalTimeout).toBeTypeOf('function') })
it('records exact create-only acknowledgment without altering failed receipts', async () => {
  const f = await fixture()
  await api.acknowledgeLocalTimeout(f)
  expect(f.fetch.mock.calls[0]).toMatchObject(['http://localhost:11434/api/ps', { method: 'GET', redirect: 'error' }])
  expect(await f.stageStore.read('local-transport/0/start')).toBe(f.start)
  expect(await f.stageStore.read('local-transport/0/result')).toBe(f.result)
  expect(JSON.parse((await f.stageStore.read('local-transport/0/recovery'))!)).toMatchObject({ resultHash: digest(f.result), startHash: digest(f.start), operator: 'test-operator', models: [] })
  await expect(api.acknowledgeLocalTimeout(f)).rejects.toThrow('LOCAL_RECOVERY_EXISTS')
})
it.each(['loaded', 'malformed', 'http', 'redirect', 'hash', 'unsettled', 'corrupt'])('refuses %s without acknowledgment', async fault => {
  const f = await fixture()
  if (fault === 'loaded') f.fetch.mockImplementation(async () => new Response('{"models":[{}]}'))
  if (fault === 'malformed') f.fetch.mockImplementation(async () => new Response('{}'))
  if (fault === 'http') f.fetch.mockImplementation(async () => new Response('{}', { status: 500 }))
  if (fault === 'redirect') f.fetch.mockImplementation(async () => { throw new Error('redirect') })
  if (fault === 'hash') f.expectedResultHash = 'f'.repeat(64)
  const read = f.stageStore.read.bind(f.stageStore)
  if (fault === 'unsettled') f.stageStore.read = async key => key.endsWith('/result') ? null : read(key)
  if (fault === 'corrupt') f.artifactStore.read = async () => Buffer.from('corrupt')
  await expect(api.acknowledgeLocalTimeout(f)).rejects.toThrow()
  expect(await read('local-transport/0/recovery')).toBeNull()
})
it('requires acknowledgment, permits a new tuple, and still rejects the failed tuple', async () => {
  const f = await fixture()
  const authorization = { mode: 'LOCAL' as const, authorized: true as const, reviewId: 'test', sourceHashes: ['d'.repeat(64)], roleContracts: { extraction: 'e'.repeat(64) } }
  const request = { model: api.localRoleModel('extraction')!, providerSlug: 'ollama', tupleHash: 'f'.repeat(64), attempt: 1 as const,
    evidence: { sourceHash: 'd'.repeat(64), contractHash: 'e'.repeat(64), role: 'extraction' },
    messages: [{ role: 'system' as const, content: 'Synthetic' }, { role: 'user' as const, content: 'Synthetic' }],
    maxPromptTokens: 14336, maxCompletionTokens: 2048, prices: { prompt: 0, completion: 0, request: 0 },
    output: { kind: 'json_schema' as const, name: 'synthetic', schema: { type: 'object' } }, validate: () => true }
  const send = vi.fn(async () => new Response(JSON.stringify({ model: request.model, done: true, done_reason: 'stop', message: { role: 'assistant', content: '{}' }, prompt_eval_count: 10, eval_count: 5 })))
  const fresh = () => api.createLocalQualificationTransport({ ...f, authorization, fetch: send })
  await expect(fresh().execute(request)).rejects.toThrow('LOCAL_HALTED')
  expect(send).not.toHaveBeenCalled()
  await api.acknowledgeLocalTimeout(f)
  await expect(fresh().execute({ ...request, tupleHash: 'a'.repeat(64) })).rejects.toThrow('LOCAL_REPLAY')
  expect(send).not.toHaveBeenCalled()
  await expect(fresh().execute(request)).resolves.toMatchObject({ value: {} })
  expect(send).toHaveBeenCalledTimes(1)
  const read = f.stageStore.read.bind(f.stageStore)
  f.stageStore.read = async key => key.endsWith('/recovery') ? (await read(key))?.replace(digest(f.result), '0'.repeat(64)) ?? null : read(key)
  await expect(fresh().execute({ ...request, tupleHash: '1'.repeat(64) })).rejects.toThrow('LOCAL_PERSISTENCE_INVALID')
  expect(send).toHaveBeenCalledTimes(1)
})
it('accepts 180s and 300s stage deadlines but refuses above 300s', async () => {
  for (const timeoutMs of [180000, 300000, 300001]) {
    const f = await fixture()
    const call = runStages({ binding: { sourceId: `sha256:${'a'.repeat(64)}`, sourceVersion: 'v1', evidenceHash: 'b'.repeat(64), evidenceVersion: 'v1', contractVersion: 'v1' }, config: Object.freeze({ reviewId: 'test', roles: Object.freeze({}) }), jobs: {}, store: f.stageStore, timeoutMs })
    if (timeoutMs > 300000) await expect(call).rejects.toThrow('BOUND_INVALID')
    else await expect(call).resolves.toHaveProperty('ready', false)
  }
})
