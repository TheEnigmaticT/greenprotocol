import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('workspace migration and acceptance coverage', () => {
  it('has the unique workspace migration and actual SQL acceptance fixture in the runner', () => {
    const migration = resolve('supabase/migrations/20261001210000_scisure_private_workspace.sql')
    expect(existsSync(migration), 'service-only workspace SQL exists').toBe(true)
    expect(readFileSync(migration, 'utf8')).toContain('gpc_record_scisure_workspace_decision')
    expect(execFileSync('python3', ['scripts/test-scisure-sql.py', '--list'], { encoding: 'utf8' })).toContain('tests/sql/scisure-workspace.sql')
  })
  it('verifies workspace migration, table RLS and both service-only RPCs offline', () => {
    const output = execFileSync('python3', ['-c', `
import importlib.util
spec = importlib.util.spec_from_file_location('v', 'scripts/verify-scisure-staging.py')
v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)
assert '20261001210000' in {version for version, _ in v.MIGRATIONS}, 'workspace migration missing'
assert 'gpc_scisure_workspace_decisions' in v.EXPECTED_RLS_TABLES
assert {'gpc_get_scisure_workspace', 'gpc_record_scisure_workspace_decision'} <= set(v.EXPECTED_SERVICE_FUNCTIONS)
print('workspace verification included')
`], { encoding: 'utf8' })
    expect(output).toContain('workspace verification included')
  })
  it('fails closed on deployed workspace table/RLS grant regressions without live credentials', () => {
    const output = execFileSync('python3', ['-c', `
import importlib.util
spec = importlib.util.spec_from_file_location('v', 'scripts/verify-scisure-staging.py')
v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)
assert hasattr(v, 'assert_private_workspace'), 'workspace privacy verifier missing'
good = {'rls': True, 'browser_select': False, 'browser_write': False, 'policy_count': 0}
v.assert_private_workspace(good)
for bad in (None, {**good, 'rls': False}, {**good, 'browser_select': True}, {**good, 'browser_write': True}, {**good, 'policy_count': 1}):
    try:
        v.assert_private_workspace(bad)
    except RuntimeError:
        pass
    else:
        raise AssertionError('private workspace regression accepted')
print('privacy verifier fails closed')
`], { encoding: 'utf8' })
    expect(output).toContain('privacy verifier fails closed')
  })
})
