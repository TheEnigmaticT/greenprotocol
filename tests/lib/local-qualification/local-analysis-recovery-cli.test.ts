import { afterEach, expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => ({ stage: vi.fn(async () => {}), transport: vi.fn(async () => {}), run: vi.fn(), open: vi.fn() }))
vi.mock('../../../lib/local-qualification/stages', async original => ({ ...await original<object>(), acknowledgeLocalStageTimeout: calls.stage }))
vi.mock('../../../lib/local-qualification/local-transport', async original => ({ ...await original<object>(), acknowledgeLocalTimeout: calls.transport }))
vi.mock('../../../lib/local-qualification/analysis', async original => ({ ...await original<object>(), runAuthorizedLocalIsolatedAnalysis: calls.run }))
vi.mock('../../../lib/local-qualification/stage-store', () => ({ createStageStore: () => ({ synthetic: 'stage' }), createLocalTransportStore: () => ({ synthetic: 'transport' }), createArtifactStore: () => ({ synthetic: 'artifacts' }) }))
vi.mock('node:fs/promises', () => ({ open: calls.open }))
vi.mock('../../../lib/local-qualification/manifests', async original => {
  const real = await original<typeof import('../../../lib/local-qualification/manifests')>()
  return { ...real, digest: (value: string | Buffer) => Buffer.isBuffer(value) ? '36ad4bcccad2ec7392e91998046b6e70c14ae9749e430a8ab5284ca64ab6c779' : real.digest(value) }
})
import * as cli from '../../../scripts/benchmarks/run-local-analysis'
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks() })
it('exposes a runnable command without executing on import', () => {
  expect(cli.main).toBeTypeOf('function')
  expect(calls.open).not.toHaveBeenCalled()
  expect(calls.transport).not.toHaveBeenCalled()
})
it('dispatches explicit stage recovery to the native stores and exact operator receipt pins without inference or idle checks', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  calls.open.mockResolvedValue({ stat: async () => ({ isFile: () => true, nlink: 1, size: 100 }), readFile: async () => Buffer.from(JSON.stringify({ cases: [{ protocolText: 'Synthetic CLI source.' }] })), close: async () => {} })
  await cli.main(['--recover-stage', 'a'.repeat(64), 'extraction', '0', '3', 'b'.repeat(64), 'c'.repeat(64), 'synthetic-operator', 'legacy-55s-60s'])
  expect(calls.stage).toHaveBeenCalledWith(expect.objectContaining({ runId: 'a'.repeat(64), stage: 'extraction', fenceIndex: 0, transportIndex: 3, expectedStageResultHash: 'b'.repeat(64), expectedTransportResultHash: 'c'.repeat(64), operator: 'synthetic-operator', analysis: expect.objectContaining({ timeoutMs: 60000, extraction: expect.objectContaining({ id: 'local-full-source-v1-extraction' }) }) }))
  expect(calls.transport).not.toHaveBeenCalled()
  expect(calls.run).not.toHaveBeenCalled()
  expect(log).toHaveBeenCalledWith(expect.stringContaining('stage-recovery-recorded-not-executed'))
})
it('dispatches transport acknowledgment explicitly without reading source or starting analysis', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await cli.main(['--acknowledge-transport', '2', 'b'.repeat(64), 'synthetic-operator'])
  expect(calls.transport).toHaveBeenCalledWith(expect.objectContaining({ index: 2, expectedResultHash: 'b'.repeat(64), operator: 'synthetic-operator' }))
  expect(calls.open).not.toHaveBeenCalled()
  expect(calls.run).not.toHaveBeenCalled()
})
it.each(['-1', '1x', '01', '4096'])('rejects malformed recovery index %s before any side effects', async index => {
  await expect(cli.main(['--acknowledge-transport', index, 'b'.repeat(64), 'synthetic-operator'])).rejects.toThrow('ARGUMENTS_INVALID')
  expect(calls.transport).not.toHaveBeenCalled()
  expect(calls.open).not.toHaveBeenCalled()
})
