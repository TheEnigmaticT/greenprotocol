import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('SciSure SQL fixture runner', () => {
  it('lists every independently executed acceptance fixture', () => {
    const output = execFileSync('python3', [resolve(process.cwd(), 'scripts/test-scisure-sql.py'), '--list'], { encoding: 'utf8' })
    expect(output.trim().split('\n')).toEqual([
      'tests/sql/scisure-bridge.sql',
      'tests/sql/scisure-guest-admission.sql',
      'tests/sql/scisure-registered-security.sql',
      'tests/sql/scisure-unlimited-admission.sql',
    ])
  })
})
