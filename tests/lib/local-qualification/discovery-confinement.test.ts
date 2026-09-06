import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const roots = ['/private/tmp/greenchemistry-ai-decomposed-benchmark/tmp', '/Users/ct-mac-mini/dev/greenchemistry-ai/tmp']
let sandbox: string | undefined
afterEach(() => {
  vi.doUnmock('node:child_process'); vi.resetModules()
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true })
  sandbox = undefined
})

// Original B1 regressions preserved, observer ported to actual Python os.read
// and os.scandir in a real subprocess. Test driver replaces module-owned roots
// and injects deterministic real rename/symlink at descriptor I/O boundaries.
async function fixture(phase: 'file' | 'directory') {
  sandbox = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'discovery-confinement-'))
  const mapped = roots.map((_, i) => join(sandbox!, String(i)))
  mapped.forEach(p => fs.mkdirSync(join(p, 'synthetic-benchmark'), { recursive: true }))
  const inside = join(mapped[0], 'synthetic-benchmark')
  const outside = join(sandbox, 'outside')
  fs.mkdirSync(outside)
  fs.writeFileSync(join(inside, 'fixture.json'), '{"sourceText":"ALLOWED"}')
  const forbidden = Buffer.from('{"sourceText":"FORBIDDEN-OUTSIDE-SYNTHETIC"}')
  fs.writeFileSync(join(outside, 'fixture.json'), forbidden)
  fs.writeFileSync(join(outside, 'outside-only.json'), '{}')
  const report = join(sandbox, 'observation.json')
  vi.resetModules()
  vi.doMock('node:child_process', () => ({ spawnSync: (command: string, _args: string[], options: Parameters<typeof spawnSync>[2]) =>
    spawnSync(command, ['-I', '-S', fileURLToPath(new URL('./discovery_test_driver.py', import.meta.url)), '--race', phase, report, ...mapped], options),
  }))
  const api = await import('../../../lib/local-qualification/discovery')
  return { api, observation: () => JSON.parse(fs.readFileSync(report, 'utf8')) as {
    replaced: boolean; consumedForbidden: boolean; enumeratedOutside: boolean; consumedAllowed: boolean; enumeratedInside: boolean; openDescriptors: number
  } }
}

describe('B1: confinement precedes reads, not merely eventual rejection', () => {
  it('never consumes outside-root payload after checked ancestor replacement', async () => {
    const { api, observation } = await fixture('file')
    expect(() => api.discoverLocalCorpus(true)).toThrow(/^DISCOVERY_UNSAFE_PATH$/)
    expect(observation().replaced).toBe(true)
    expect(observation().consumedForbidden).toBe(false)
    expect(observation().consumedAllowed).toBe(true)
    expect(observation().openDescriptors).toBe(0)
  })
  it('never enumerates a replacement symlink target directory', async () => {
    const { api, observation } = await fixture('directory')
    expect(() => api.discoverLocalCorpus(true)).toThrow(/^DISCOVERY_UNSAFE_PATH$/)
    expect(observation().replaced).toBe(true)
    expect(observation().enumeratedOutside).toBe(false)
    expect(observation().enumeratedInside).toBe(true)
    expect(observation().openDescriptors).toBe(0)
  })
})
