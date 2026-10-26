import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const file = 'supabase/migrations/20261001220000_scisure_owned_workspace_recovery.sql'
describe('owned saved SciSure workspace recovery boundary', () => {
  it('provides account recovery independent of an expired popup connection', () => {
    expect(existsSync(file)).toBe(true)
    const sql = readFileSync(file, 'utf8')
    expect(sql).toContain('gpc_get_owned_scisure_workspace')
    expect(sql).toContain('p_owner_user_id')
    expect(sql).toContain("p.kind='registered'")
    expect(sql).toContain('a.user_id=p_owner_user_id')
    expect(sql).toContain('snapshot.expires_at>now()')
    expect(sql).not.toContain('c.expires_at>now()')
    expect(sql).toContain('FROM PUBLIC,anon,authenticated')
    expect(sql).toContain('TO service_role')
  })
})
