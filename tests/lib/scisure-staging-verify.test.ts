import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('SciSure staging verification script', () => {
  it('documents its fixed staging target without reading credentials for help', () => {
    const output = execFileSync('python3', [resolve(process.cwd(), 'scripts/verify-scisure-staging.py'), '--help'], { encoding: 'utf8' })
    expect(output).toContain('qqyzyezwlzvckjtggoes')
    expect(output).toContain('credentials')
  })
})
