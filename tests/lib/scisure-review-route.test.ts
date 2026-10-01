import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorizeConnection: vi.fn(), requireSciSureOrigin: vi.fn(), createClient: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/integrations/scisure/server', () => ({ authorizeConnection: mocks.authorizeConnection, requireSciSureOrigin: mocks.requireSciSureOrigin }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
import { POST } from '@/app/api/integrations/scisure/snapshots/[id]/decisions/route'

function request(body: unknown, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/integrations/scisure/snapshots/snapshot-1/decisions', { method: 'POST', headers: { authorization: 'Bearer bridge-secret', 'x-gcai-bridge-session': 'bridge-1', 'x-gcai-scisure-origin': 'https://sandbox.scisure.test', origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

describe('SciSure scientist review decision route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireSciSureOrigin.mockReturnValue('https://sandbox.scisure.test')
    mocks.authorizeConnection.mockResolvedValue({ admin: { rpc: mocks.rpc }, connection: { id: 'bridge-1', principal_id: 'principal-1', owner_user_id: 'user-1' } })
    mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) } })
    mocks.rpc.mockResolvedValue({ data: true, error: null })
  })

  it('submits only session-derived reviewer identity to the atomic server-only decision RPC', async () => {
    const response = await POST(request({ recommendationId: 'rec-safe', decision: 'approved_for_experiment', sourceHash: 'a'.repeat(64), analysisRevision: 1 }), { params: Promise.resolve({ id: 'snapshot-1' }) })
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('gpc_record_scisure_review_decision', {
      p_snapshot_id: 'snapshot-1', p_principal_id: 'principal-1', p_reviewer_user_id: 'user-1', p_recommendation_id: 'rec-safe',
      p_decision: 'approved_for_experiment', p_source_hash: 'a'.repeat(64), p_analysis_revision: 1,
    })
  })

  it('rejects cross-site requests before the RPC is called', async () => {
    const response = await POST(request({ recommendationId: 'rec-safe', decision: 'approved_for_experiment', sourceHash: 'a'.repeat(64), analysisRevision: 1 }, 'https://attacker.test'), { params: Promise.resolve({ id: 'snapshot-1' }) })
    expect(response.status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
