import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('SciSure registered quota ledger hardening', () => {
  it('adds RLS to the registered quota ledger in a follow-up immutable migration', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261001050000_enable_registered_quota_ledger_rls.sql'), 'utf8')
    expect(sql).toContain('ALTER TABLE gpc_registered_analysis_quota_ledger ENABLE ROW LEVEL SECURITY;')
  })
})
