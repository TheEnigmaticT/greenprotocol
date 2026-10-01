import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), parse: vi.fn(), rpc: vi.fn(), getUserById: vi.fn(),
  principal: { kind: 'registered', user_id: 'owner-1', guest_subject_id: null as string | null },
}))
vi.mock('@/lib/integrations/scisure', () => ({ parseSciSureAdmission: mocks.parse }))
vi.mock('@/lib/integrations/scisure/server', () => ({ authorizeConnection: mocks.authorize, requireSciSureOrigin: () => 'https://sandbox.elabjournal.com' }))
import { POST } from '@/app/api/integrations/scisure/snapshots/route'

const admission = () => ({ bridgeSessionId: 'bridge-1', nonce: 'nonce-1', requestId: 'request-1', sourceHash: 'a'.repeat(64), source: { protocolText: 'Reviewed protocol text' }, email: { address: '', deliveryConsent: false, marketingConsent: false } })
const submit = () => POST(new Request('https://staging.greenchemistry.ai/api/integrations/scisure/snapshots', { method: 'POST', headers: { authorization: 'Bearer connection-token' }, body: '{}' }))

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ANALYSIS_RUN_LIMIT
  delete process.env.SCISURE_GUEST_TRIAL_LIMIT
  mocks.principal = { kind: 'registered', user_id: 'owner-1', guest_subject_id: null }
  mocks.parse.mockReturnValue(admission())
  mocks.getUserById.mockResolvedValue({ data: { user: { id: 'owner-1', email: 'trevor@greenchemistry.ai', email_confirmed_at: '2026-01-01' } }, error: null })
  mocks.rpc.mockImplementation(async (_name, args) => args.p_limit === null
    ? { data: [{ job_id: 'job-1', replayed: false }], error: null }
    : { data: null, error: { message: 'analysis quota exhausted' } })
  const admin = {
    auth: { admin: { getUserById: mocks.getUserById } }, rpc: mocks.rpc,
    from: (table: string) => table === 'gpc_external_source_snapshots'
      ? { upsert: () => ({ select: () => ({ single: async () => ({ data: { id: 'snapshot-1' }, error: null }) }) }) }
      : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.principal, error: null }) }) }) },
  }
  mocks.authorize.mockResolvedValue({ admin, connection: { id: 'bridge-1', principal_id: 'principal-1' } })
})

describe('SciSure registered entitlement parity', () => {
  it('admits a verified greenchemistry.ai owner after the standard quota is exhausted', async () => {
    expect((await submit()).status).toBe(202)
    expect(mocks.getUserById).toHaveBeenCalledWith('owner-1')
    expect(mocks.rpc).toHaveBeenCalledWith('gpc_reserve_scisure_job', expect.objectContaining({ p_limit: null }))
  })
  it('preserves the existing individually allowlisted account', async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: { id: 'owner-1', email: 'trevor.longino+gc1@gmail.com', email_confirmed_at: '2026-01-01' } }, error: null })
    expect((await submit()).status).toBe(202)
  })
  it('does not grant unlimited access from a spoofed consent email', async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: { id: 'owner-1', email: 'ordinary@example.com', email_confirmed_at: '2026-01-01' } }, error: null })
    mocks.parse.mockReturnValue({ ...admission(), email: { address: 'trevor@greenchemistry.ai', deliveryConsent: false, marketingConsent: false } })
    expect((await submit()).status).toBe(400)
    expect(mocks.rpc).toHaveBeenCalledWith('gpc_reserve_scisure_job', expect.objectContaining({ p_limit: 10 }))
  })
  it('fails closed if the registered principal has no verified Auth identity', async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: null }, error: { message: 'not found' } })
    expect((await submit()).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects an Auth identity mismatch', async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: { id: 'other-owner', email: 'trevor@greenchemistry.ai', email_confirmed_at: '2026-01-01' } }, error: null })
    expect((await submit()).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('does not grant unlimited access to an unconfirmed domain email', async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: { id: 'owner-1', email: 'trevor@greenchemistry.ai', email_confirmed_at: null } }, error: null })
    expect((await submit()).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('retains the guest trial cap without consulting registered entitlements', async () => {
    mocks.principal = { kind: 'guest', user_id: '', guest_subject_id: 'subject-1' }
    expect((await submit()).status).toBe(400)
    expect(mocks.getUserById).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith('gpc_reserve_scisure_guest_job', expect.objectContaining({ p_limit: 1 }))
  })
})
