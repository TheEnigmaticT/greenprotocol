import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

describe('full local analysis CLI argument gate', () => {
  it('rejects unknown input paths and modes before source access or inference', () => {
    const result = spawnSync(resolve('node_modules/.bin/tsx'), ['scripts/benchmarks/run-local-analysis.ts', '--unknown', '/not-an-authorized-source'], { encoding: 'utf8', timeout: 10_000 })
    expect(result.status).toBe(1)
    expect(result.stderr.trim()).toBe('LOCAL_ANALYSIS_FAILED: private artifacts retained; no automatic retry')
    expect(result.stdout).toBe('')
  })
})
