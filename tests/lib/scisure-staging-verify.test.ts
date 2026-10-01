import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const verifier = resolve(process.cwd(), 'scripts/verify-scisure-staging.py')

const verifierFailure = (body: string) => execFileSync('python3', ['-c', `
import importlib.util
spec = importlib.util.spec_from_file_location('verify', ${JSON.stringify(verifier)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
${body}
`], { encoding: 'utf8' })

describe('SciSure staging verification script', () => {
  it('includes every SciSure migration in source-hash verification', () => {
    const output = verifierFailure(`
from pathlib import Path
versions = {version for version, _ in module.MIGRATIONS}
files = Path(${JSON.stringify(process.cwd())}) / 'supabase/migrations'
expected = {path.name.split('_', 1)[0] for path in files.glob('20261001*.sql')}
missing = expected - versions
if missing:
    raise RuntimeError('unverified SciSure migrations: ' + ','.join(sorted(missing)))
print('all included')
`)
    expect(output).toContain('all included')
  })
  it('documents its fixed staging target without reading credentials for help', () => {
    const output = execFileSync('python3', [verifier, '--help'], { encoding: 'utf8' })
    expect(output).toContain('qqyzyezwlzvckjtggoes')
    expect(output).toContain('credentials')
  })

  it('rejects a service-only RPC privilege regression instead of only printing it', () => {
    const output = verifierFailure(`
try:
    module.assert_service_only_functions([{'signature': 'gpc_lease_partner_mail(integer)', 'security_definer': True, 'anon_execute': True, 'authenticated_execute': False, 'service_role_execute': True}])
except RuntimeError as error:
    print(error)
else:
    raise SystemExit('bad privileges were accepted')
`)
    expect(output).toContain('service-only RPC privilege invariant failed')
  })

  it('rejects a missing expected RPC and source migration hash', () => {
    const output = verifierFailure(`
for check in (
    lambda: module.assert_service_only_functions([]),
    lambda: module.assert_migration_hashes([], {'20261001060000': 'expected'}),
):
    try:
        check()
    except RuntimeError as error:
        print(error)
    else:
        raise SystemExit('missing staging evidence was accepted')
`)
    expect(output).toContain('service-only RPC privilege invariant failed')
    expect(output).toContain('Staging migration source hashes do not match committed source bytes.')
  })
})
