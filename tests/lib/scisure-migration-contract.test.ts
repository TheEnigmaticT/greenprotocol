import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationDirectory = resolve(process.cwd(), 'supabase/migrations')
const migrationFiles = () => readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql')).sort()

describe('SciSure migration contract', () => {
  it('uses a unique version prefix for every migration filename', () => {
    const versions = migrationFiles().map((name) => name.match(/^(\d+)_/)?.[1])
    expect(versions).not.toContain(undefined)
    expect(new Set(versions).size).toBe(versions.length)
  })

  it('places mail acceptance after the already-applied quota RLS migration', () => {
    expect(migrationFiles()).toContain('20261001060000_record_mail_acceptance_not_delivery.sql')
    expect(migrationFiles()).not.toContain('20261001050000_record_mail_acceptance_not_delivery.sql')
  })

  it('reasserts service-only execution after every recreated mail RPC', () => {
    const sql = readFileSync(resolve(migrationDirectory, '20261001060000_record_mail_acceptance_not_delivery.sql'), 'utf8')
    for (const [name, signature] of [
      ['gpc_lease_partner_mail', 'gpc_lease_partner_mail(INTEGER)'],
      ['gpc_finalize_partner_mail', 'gpc_finalize_partner_mail(UUID,UUID,TEXT,TEXT,TEXT)'],
    ]) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION ${name}`)
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated;`)
    }
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION')
    expect(sql).toContain('TO service_role;')
  })
})
