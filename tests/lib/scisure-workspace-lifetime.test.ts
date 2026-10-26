import { createHash, createHmac } from 'node:crypto'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ cookies: vi.fn(), createClient: vi.fn(), from: vi.fn(), insert: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from }) }))
import { createConnection } from '@/lib/integrations/scisure/server'

describe('workspace connection lifetime', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T12:00:00Z')); vi.clearAllMocks()
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-only'); vi.stubEnv('SCISURE_NONCE_HASH_KEY', 'fixture-only'.repeat(4)); vi.stubEnv('SCISURE_ALLOWED_ORIGINS', 'https://sandbox.elabjournal.com'); vi.stubEnv('SCISURE_GUEST_ADMISSION_HMAC_KEY', 'fixture-only')
    mocks.insert.mockImplementation((input) => ({ select: () => ({ single: async () => ({ data: { id: 'bridge-1', expires_at: input.expires_at }, error: null }) }) }))
    mocks.from.mockImplementation((table: string) => {
      if (table === 'gpc_scisure_connections') return { insert: mocks.insert }
      if (table === 'gpc_scisure_principals') return { upsert: (input: Record<string, unknown>) => ({ select: () => ({ single: async () => ({ data: { id: 'principal-1', ...input }, error: null }) }) }) }
      const data = table === 'gpc_scisure_guest_admissions' ? { subject_id: 'subject-verified', expires_at: '2026-10-01T12:20:00Z' } : { expires_at: '2026-10-01T13:00:00Z' }
      const chain = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), gt: vi.fn(), maybeSingle: async () => ({ data, error: null }) }
      chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.is.mockReturnValue(chain); chain.gt.mockReturnValue(chain); return chain
    })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
  it('issues a registered connection valid for at least 67 minutes', async () => {
    mocks.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } } }) } })
    const result = await createConnection({ nonce: 'a'.repeat(64), origin: 'https://sandbox.elabjournal.com' })
    expect(Date.parse(result.expiresAt) - Date.now()).toBeGreaterThanOrEqual(67 * 60_000)
  })
  it('caps guest connection by actual verified admission expiry, not longer token claims', async () => {
    mocks.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } })
    const bind = createHash('sha256').update('fixture-binding').digest('hex')
    const payload = Buffer.from(JSON.stringify({ exp: Date.parse('2026-10-01T13:00:00Z') / 1000, sub: 'subject-verified', bind })).toString('base64url')
    const token = payload + '.' + createHmac('sha256', 'fixture-only').update(payload).digest('hex')
    mocks.cookies.mockResolvedValue({ get: (key: string) => ({ value: key === 'gcai_scisure_guest' ? token : 'fixture-binding' }) })
    const result = await createConnection({ nonce: 'a'.repeat(64), origin: 'https://sandbox.elabjournal.com' })
    expect(result.expiresAt).toBe('2026-10-01T12:20:00.000Z')
  })
})
