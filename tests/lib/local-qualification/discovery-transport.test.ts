import { spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'

const python = '/Library/Developer/CommandLineTools/usr/bin/python3'
const driver = fileURLToPath(new URL('./discovery_test_driver.py', import.meta.url))
afterEach(() => { vi.doUnmock('node:child_process'); vi.doUnmock('node:fs'); vi.resetModules() })

it.each(['success', 'capability', 'failure', 'timeout', 'truncated', 'oversize', 'extra', 'order', 'stderr', 'bad-error', 'count', 'buffer-limit'])('real pinned subprocess bridge: %s', async mode => {
  // Guard the pre-integration RED against operational filesystem access.
  vi.doMock('node:fs', () => ({ lstatSync: () => { throw new Error('TEST_NO_PRIVATE_IO') } }))
  const calls: unknown[][] = []
  vi.doMock('node:child_process', () => ({ spawnSync: (command: string, args: string[], options: Parameters<typeof spawnSync>[2]) => {
    calls.push([command, args, options])
    // Replace only module-owned helper in test. No production override exists.
    return spawnSync(command, ['-I', '-S', driver, '--transport', mode], { ...options, ...(mode === 'timeout' ? { timeout: 50 } : {}), ...(mode === 'buffer-limit' ? { maxBuffer: 100 } : {}) })
  } }))
  const { discoverLocalCorpus } = await import('../../../lib/local-qualification/discovery')
  if (mode === 'success' || mode === 'stderr') expect(discoverLocalCorpus(true).fileCount).toBe(1)
  else expect(() => discoverLocalCorpus(true)).toThrow(/^DISCOVERY_(UNSAFE_PATH|LIMIT)$/)
  expect(calls).toHaveLength(1)
  expect(calls[0][0]).toBe(python)
  expect(calls[0][1]).toEqual(['-I', '-S', expect.stringMatching(/\/lib\/local-qualification\/discovery_boundary\.py$/)])
  expect(calls[0][2]).toMatchObject({ shell: false, env: {}, stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 + 2048 * 6 + 12 })
})
