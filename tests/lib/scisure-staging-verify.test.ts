import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const verifier = resolve(process.cwd(), 'scripts/verify-scisure-staging.py')

describe('SciSure staging verification script', () => {
  it('documents its fixed staging target without reading credentials for help', () => {
    const output = execFileSync('python3', [verifier, '--help'], { encoding: 'utf8' })
    expect(output).toContain('qqyzyezwlzvckjtggoes')
    expect(output).toContain('credentials')
  })

  it('rejects a service-only RPC privilege regression instead of only printing it', () => {
    const output = execFileSync('python3', ['-c', `
import importlib.util
spec = importlib.util.spec_from_file_location('verify', ${JSON.stringify(verifier)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
try:
    module.assert_service_only_functions([{'signature': 'gpc_lease_partner_mail(integer)', 'security_definer': True, 'anon_execute': True, 'authenticated_execute': False, 'service_role_execute': True}])
except RuntimeError as error:
    print(error)
else:
    raise SystemExit('bad privileges were accepted')
`], { encoding: 'utf8' })
    expect(output).toContain('service-only RPC privilege invariant failed')
  })
})
