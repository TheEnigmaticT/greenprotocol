import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: { id: 'owner-1' } as { id: string } | null, rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))
const id = '00000000-0000-0000-0000-000000000221'
const request = () => new Request(`https://staging.greenchemistry.ai/api/integrations/scisure/analyses/${id}/workspace`)
async function read() { const { GET } = await import('@/app/api/integrations/scisure/analyses/[id]/workspace/route'); return GET(request(), { params: Promise.resolve({ id }) }) }
beforeEach(() => {
  mocks.user = { id: 'owner-1' }; mocks.rpc.mockReset()
  mocks.rpc.mockResolvedValue({ data: { version: 2, analysisId: id, principalKind: 'registered', status: 'completed', analysisRevision: 1, sourceHash: 'a'.repeat(64), source: { selection: [], protocolText: 'Private source' }, analysis: { recommendations: [], steps: [] }, decisions: {}, retentionExpiresAt: '2099-01-01T00:00:00Z' }, error: null })
})
describe('saved workspace owner-authenticated readback', () => {
  it('loads retained review state without an old popup credential', async () => {
    const response = await read()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.rpc).toHaveBeenCalledWith('gpc_get_owned_scisure_workspace', { p_analysis_id: id, p_owner_user_id: 'owner-1' })
    expect(await response.json()).toMatchObject({ version: 2, analysisId: id, findings: [] })
  })
  it('never recovers by an unsigned or matching email string', async () => {
    mocks.user = null
    expect((await read()).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('returns no source for another owner or expired retention', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    const response = await read()
    expect(response.status).toBe(404)
    expect(await response.json()).not.toHaveProperty('source')
  })
})
