import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OLLAMA_PILOT_MODELS } from '../../../lib/decomposed-benchmark/ollama-provider'
import { createTestStageStore, createTestArtifactStore } from '../../../lib/local-qualification/stage-store'
import { LIVE_APPROVAL, type QualificationRequest } from '../../../lib/local-qualification/provider'
const api = await import('../../../lib/local-qualification/local-transport').catch(() => ({})) as typeof import('../../../lib/local-qualification/local-transport')
const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0 })
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'local-transport-synthetic-')); roots.push(root)
  const stageStore = createTestStageStore({ root, synthetic: true }), artifactStore = createTestArtifactStore({ root, synthetic: true })
  const authorization = { mode: 'LOCAL' as const, authorized: true as const, reviewId: 'synthetic-local', sourceHashes: ['a'.repeat(64)], roleContracts: { extraction: 'b'.repeat(64), inventory: 'c'.repeat(64), 'applicability-P5': 'd'.repeat(64) } }
  const request: QualificationRequest = { model: OLLAMA_PILOT_MODELS[0], providerSlug: 'ollama', tupleHash: 'e'.repeat(64), attempt: 1,
    messages: [{ role: 'system', content: 'Synthetic instruction' }, { role: 'user', content: 'Synthetic source' }],
    maxPromptTokens: 14336, maxCompletionTokens: 2048, prices: { prompt: 0, completion: 0, request: 0 },
    evidence: { sourceHash: authorization.sourceHashes[0], contractHash: authorization.roleContracts.extraction, role: 'extraction' },
    output: { kind: 'json_schema', name: 'synthetic', schema: { type: 'object' } }, validate: v => (v as { ok?: boolean })?.ok === true }
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => { const body = JSON.parse(init!.body as string); return new Response(JSON.stringify({ model: body.model, done: true, done_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' }, prompt_eval_count: 10, eval_count: 5 })) })
  return { authorization, request, stageStore, artifactStore, fetcher }
}
it('exports separately authorized LOCAL transport without changing hosted approval', () => {
  expect(api.createLocalQualificationTransport).toBeTypeOf('function')
  expect(LIVE_APPROVAL.approved).toBe(false)
})
it('preserves exact schema and role identities, persists raw receipts, refuses replay', async () => {
  const f = fixture(), transport = api.createLocalQualificationTransport({ ...f, fetch: f.fetcher })
  const response = await transport.execute(f.request)
  expect(response.value).toEqual({ ok: true }); expect(response.model).toBe(f.request.model)
  expect(f.fetcher.mock.calls[0][0]).toBe('http://localhost:11434/api/chat')
  const body = JSON.parse(f.fetcher.mock.calls[0][1]!.body as string)
  expect(body.format).toEqual(f.request.output.schema); expect(body.options).toEqual({ temperature: 0, num_predict: 2048, num_ctx: 16384 })
  const receipt = JSON.parse((await f.stageStore.read('local-transport/0/result'))!)
  expect(await f.artifactStore.read(receipt.rawHash)).not.toBeNull()
  await expect(transport.execute(f.request)).rejects.toThrow('LOCAL_REPLAY')
  const auditor = { ...f.request, model: OLLAMA_PILOT_MODELS[1], tupleHash: 'f'.repeat(64), evidence: { ...f.request.evidence!, role: 'inventory', contractHash: f.authorization.roleContracts.inventory } }
  await expect(transport.execute(auditor)).resolves.toMatchObject({ model: OLLAMA_PILOT_MODELS[1] })
  const applicability = { ...auditor, tupleHash: '1'.repeat(64), evidence: { ...auditor.evidence, role: 'applicability-P5', contractHash: f.authorization.roleContracts['applicability-P5'] } }
  await expect(transport.execute(applicability)).resolves.toMatchObject({ model: OLLAMA_PILOT_MODELS[1] })
  expect(LIVE_APPROVAL.approved).toBe(false)
})
it.each(['source', 'contract', 'model', 'provider', 'tool', 'limit', 'authorization'])('rejects %s mismatch before any transport', async fault => {
  const f = fixture()
  if (fault === 'source') f.request.evidence!.sourceHash = 'f'.repeat(64)
  if (fault === 'contract') f.request.evidence!.contractHash = 'f'.repeat(64)
  if (fault === 'model') f.request.model = OLLAMA_PILOT_MODELS[1]
  if (fault === 'provider') f.request.providerSlug = 'deepinfra/turbo'
  if (fault === 'tool') f.request.output.kind = 'tool'
  if (fault === 'limit') f.request.maxCompletionTokens = 4000
  if (fault === 'authorization') f.authorization.authorized = false as never
  await expect(async () => api.createLocalQualificationTransport({ ...f, fetch: f.fetcher }).execute(f.request)).rejects.toThrow()
  expect(f.fetcher).not.toHaveBeenCalled()
})
it('persists semantic rejection and prevents subsequent calls even through a fresh instance', async () => {
  const f = fixture(); f.request.validate = () => false
  await expect(api.createLocalQualificationTransport({ ...f, fetch: f.fetcher }).execute(f.request)).rejects.toThrow('LOCAL_OUTPUT_INVALID')
  const record = JSON.parse((await f.stageStore.read('local-transport/0/result'))!)
  expect(record.status).toBe('error'); expect(await f.artifactStore.read(record.rawHash)).not.toBeNull()
  await expect(api.createLocalQualificationTransport({ ...f, fetch: f.fetcher }).execute({ ...f.request, tupleHash: 'f'.repeat(64) })).rejects.toThrow('LOCAL_HALTED')
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})
