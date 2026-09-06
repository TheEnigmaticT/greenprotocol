import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as provider from '../../../lib/local-qualification/provider'
import * as manifests from '../../../lib/local-qualification/manifests'

const roots: string[] = []
const hash = 'a'.repeat(64)
const model = 'google/gemma-4-31b-it'
const mission = { id: 'new-sprint', sourceEvidence: [hash], contractHash: hash, roleModels: { extractor: model } }
function setup(fetcher: typeof fetch) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'live-provider-synthetic-')); roots.push(root)
  vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-only')
  return { root, runtime: provider.createTestProvider({ root, historicalMicroUsd: 0, fetch: fetcher, mission }) }
}
const request = () => ({ tupleHash: hash, attempt: 1, model, messages: [{ role: 'user' as const, content: 'synthetic' }], maxPromptTokens: 262144, maxCompletionTokens: 100, prices: { prompt: 1, completion: 2, request: 0 }, output: { kind: 'json_schema' as const, name: 'answer', schema: { type: 'object' } }, evidence: { sourceHash: hash, contractHash: hash, role: 'extractor' }, validate: (v: unknown) => !!v })
const response = () => new Response(JSON.stringify({ model, provider: 'Synthetic', usage: { cost: 0.0001, prompt_tokens: 40, completion_tokens: 5, total_tokens: 45 }, choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }))
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); roots.forEach(root => rmSync(root, { recursive: true, force: true })); roots.length = 0 })
it('ships immutable OFF approval; arbitrary token and env cannot authorize live fetch', () => {
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NO NETWORK'))
  vi.stubEnv('LOCAL_QUALIFICATION_APPROVED', 'true')
  expect(provider.LIVE_APPROVAL.approved).toBe(false)
  expect(Object.isFrozen(provider.LIVE_APPROVAL)).toBe(true)
  expect(() => provider.createProvider({ approvalToken: 'fake', mission })).toThrow('LIVE_NOT_APPROVED')
  expect(network).not.toHaveBeenCalled()
})
it('uses fixed attempts directory, separate from corpus root', () => {
  expect(manifests.ATTEMPTS_ROOT).toBe(join(manifests.PRIVATE_ROOT, 'attempts'))
})
it('verifies pinned inputs without authorizing a provider', () => {
  const content = 'synthetic reviewed bytes'
  const manifest = { approved: true, tokenHash: manifests.digest('synthetic-token'), inputHashes: Object.fromEntries(provider.REVIEW_INPUTS.map(path => [path, manifests.digest(content)])) }
  expect(() => provider.verifyApprovalManifest(manifest, 'wrong', () => content)).toThrow('LIVE_NOT_APPROVED')
  expect(() => provider.verifyApprovalManifest(manifest, 'synthetic-token', () => content + 'changed')).toThrow('APPROVAL_STALE')
  expect(() => provider.verifyApprovalManifest({ ...manifest, inputHashes: {} }, 'synthetic-token', () => content)).toThrow('APPROVAL_STALE')
  expect(() => provider.verifyApprovalManifest(manifest, 'synthetic-token', () => content)).not.toThrow()
  expect(() => provider.createProvider({ approvalToken: 'synthetic-token', mission })).toThrow('LIVE_NOT_APPROVED')
})
it('pins exact provider endpoint and rejects returned provider mismatch', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response()); const { runtime } = setup(fetcher)
  await expect(runtime.execute({ ...request(), providerSlug: 'deepinfra/turbo' })).rejects.toThrow('PROVIDER_MISMATCH')
  expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string).provider.only).toEqual(['deepinfra/turbo'])
})
it('persists mission evidence, configuration and bounded safe telemetry via shared core', async () => {
  const { root, runtime } = setup(vi.fn(async () => response()))
  const result = await runtime.execute(request())
  expect(result.telemetry).toMatchObject({ requestedModel: model, returnedModel: model, provider: 'Synthetic', promptTokens: 40, completionTokens: 5, totalTokens: 45, costMicroUsd: 100, errorCode: null })
  expect(result.telemetry.latencyMs).toBeGreaterThanOrEqual(0)
  const header = JSON.parse(readFileSync(join(root, 'ledger.json'), 'utf8'))
  expect(header.mission).toEqual(mission)
  const reservation = JSON.parse(readFileSync(join(root, readdirSync(root).find(f => f.endsWith('.reserve.json'))!), 'utf8'))
  expect(reservation.metadata).toMatchObject({ evidence: request().evidence, requestedModel: model, maxPromptTokens: 262144, transport: { allowFallbacks: false, requireParameters: true } })
  const outcome = JSON.parse(readFileSync(join(root, readdirSync(root).find(f => f.endsWith('.outcome.json'))!), 'utf8'))
  expect(outcome.telemetry).toEqual(result.telemetry)
  expect(() => manifests.createTestLedger({ root, historicalMicroUsd: 0, mission: { ...mission, id: 'changed' } }).snapshot()).toThrow('MISSION_MISMATCH')
})
it('rejects configured prompt bounds below or above catalog full context before fetch', async () => {
  const network = vi.fn(async () => response()); const { runtime } = setup(network)
  for (const maxPromptTokens of [10000, 262145]) await expect(runtime.execute({ ...request(), maxPromptTokens })).rejects.toThrow('CONTEXT_BOUND_INVALID')
  expect(network).not.toHaveBeenCalled()
})
it('enforces the conservative common completion ceiling for both pinned endpoints', async () => {
  const network = vi.fn(async () => response()); const { runtime } = setup(network)
  for (const providerSlug of [undefined, 'deepinfra/turbo', 'coreweave/fp4']) {
    await expect(runtime.execute({ ...request(), providerSlug, maxCompletionTokens: 16385 })).rejects.toThrow('INVALID_INPUT')
  }
  expect(network).not.toHaveBeenCalled()
})
it.each([{ slug: 'deepinfra/turbo', name: 'DeepInfra' }, { slug: 'coreweave/fp4', name: 'CoreWeave' }])('accepts the common completion ceiling on $slug', async ({ slug, name }) => {
  const network = vi.fn(async () => {
    const payload = await response().json()
    return new Response(JSON.stringify({ ...payload, provider: name }))
  })
  const { runtime } = setup(network)
  await expect(runtime.execute({ ...request(), providerSlug: slug, maxCompletionTokens: 16384 })).resolves.toMatchObject({ model })
  expect(network).toHaveBeenCalledTimes(1)
})
it('binds request source contract and role model to mission before fetch', async () => {
  const network = vi.fn(async () => response()); const { runtime } = setup(network)
  await expect(runtime.execute({ ...request(), evidence: { ...request().evidence, sourceHash: 'b'.repeat(64) } })).rejects.toThrow('MISSION_MISMATCH')
  expect(network).not.toHaveBeenCalled()
})
it('retains safe error telemetry and charges unknown failures conservatively', async () => {
  const { root, runtime } = setup(vi.fn(async () => { throw new Error('private prompt and secret') }))
  await expect(runtime.execute(request())).rejects.toThrow('TRANSPORT_ERROR')
  const outcome = JSON.parse(readFileSync(join(root, readdirSync(root).find(f => f.endsWith('.outcome.json'))!), 'utf8'))
  expect(outcome.telemetry).toMatchObject({ requestedModel: model, returnedModel: null, provider: null, errorCode: 'TRANSPORT_ERROR', costMicroUsd: null })
  expect(JSON.stringify(outcome)).not.toContain('private prompt')
})
it('binds distinct frozen role contracts within the same sprint instead of requiring one prompt hash for all roles', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'role-contract-synthetic-')); roots.push(root)
  vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-only')
  const pinned = { ...mission, roleModels: { extractor: model, inventory: model }, roleContracts: { extractor: hash, inventory: 'b'.repeat(64) } }
  const network = vi.fn(async () => response())
  const runtime = provider.createTestProvider({ root, historicalMicroUsd: 0, fetch: network, mission: pinned })
  await expect(runtime.execute({ ...request(), evidence: { sourceHash: hash, role: 'inventory', contractHash: 'b'.repeat(64) } })).resolves.toMatchObject({ model })
  await expect(runtime.execute({ ...request(), tupleHash: 'c'.repeat(64), evidence: { sourceHash: hash, role: 'inventory', contractHash: hash } })).rejects.toThrow('MISSION_MISMATCH')
  expect(network).toHaveBeenCalledTimes(1)
  expect(manifests.createTestLedger({ root, historicalMicroUsd: 0, mission: pinned }).snapshot().attempts).toBe(1)
  expect(() => manifests.ownMission({ ...pinned, roleContracts: { extractor: hash } })).toThrow('MISSION_INVALID')
})
it('requires review fingerprints for the actual integrated dependency closure', () => {
  expect(provider.REVIEW_INPUTS).toEqual(expect.arrayContaining([
    'lib/local-qualification/analysis.ts', 'lib/local-qualification/stage-store.ts',
    'lib/local-qualification/extraction-jobs.ts', 'lib/local-qualification/principle-jobs.ts',
    'lib/local-qualification/source.ts', 'lib/local-qualification/graph.ts',
    'lib/local-qualification/coverage-audit.ts', 'lib/local-qualification/claim-audit.ts',
    'lib/local-qualification/evidence.ts', 'lib/local-qualification/decisions.ts',
    'lib/local-qualification/principles.ts', 'lib/local-qualification/corpus.ts',
    'lib/local-qualification/reporting.ts', 'lib/local-qualification/patch.ts',
    'docs/benchmarks/live-provider-spec-rereview.md',
  ]))
})
