import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Faults now execute at Python descriptor primitives on test-owned fixtures.
// Original check expectations are unchanged; no node:fs mocks claim IPC proof.
let sandbox: string | undefined
type Fault = 'symlink' | 'ancestor-file' | 'missing' | 'permission' | 'unknown' | 'hardlink' | 'descriptor' | 'mutation' | 'short-read' | 'directory-mutation'
async function fixture(fault: Fault) {
  sandbox = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'discovery-checks-'))
  const roots = [join(sandbox, '0'), join(sandbox, '1')]
  for (const root of roots) fs.mkdirSync(join(root, 'synthetic-benchmark'), { recursive: true })
  fs.writeFileSync(join(roots[0], 'synthetic-benchmark/fixture.json'), '{"sourceText":"ALLOWED"}')
  const report = join(sandbox, 'observation.json')
  vi.resetModules()
  vi.doMock('node:child_process', () => ({ spawnSync: (command: string, _args: string[], options: Parameters<typeof spawnSync>[2]) =>
    spawnSync(command, ['-I', '-S', fileURLToPath(new URL('./discovery_test_driver.py', import.meta.url)), '--fault', fault, report, ...roots], options),
  }))
  return { api: await import('../../../lib/local-qualification/discovery'), observation: () => JSON.parse(fs.readFileSync(report, 'utf8')) as { openDescriptors: number } }
}
afterEach(() => {
  vi.doUnmock('node:child_process'); vi.resetModules()
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true })
  sandbox = undefined
})

describe('discovery check attribution without private I/O', () => {
  it.each([
    ['symlink', 'SYMLINK_COMPONENT'], ['ancestor-file', 'NON_DIRECTORY_COMPONENT'],
    ['missing', 'PATH_MISSING'], ['permission', 'ACCESS_DENIED'], ['unknown', 'FILESYSTEM_ERROR'],
    ['hardlink', 'NON_REGULAR_OR_MULTILINK'], ['descriptor', 'OPEN_IDENTITY_CHANGED'],
    ['mutation', 'FILE_CHANGED'], ['short-read', 'READ_LENGTH_CHANGED'],
    ['directory-mutation', 'DIRECTORY_CHANGED'],
  ] as const)('%s preserves rejection and reports only %s', async (fault, check) => {
    const { api, observation } = await fixture(fault)
    let caught: unknown
    try { api.discoverLocalCorpus(true) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).toMatchObject({ message: 'DISCOVERY_UNSAFE_PATH', check })
    expect(JSON.stringify(caught)).not.toContain('PRIVATE-SENTINEL')
    expect(JSON.stringify(caught)).not.toContain('credential')
    expect((caught as Error).cause).toBeUndefined()
    expect(observation().openDescriptors).toBe(0)
  })
})
