import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { workspace, analysis } from './scisure-workspace-fixture'
const mocks = vi.hoisted(() => ({ authorizeConnection: vi.fn(), authenticatedPrincipal: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/integrations/scisure/server', () => ({ authorizeConnection: mocks.authorizeConnection, authenticatedPrincipal: mocks.authenticatedPrincipal }))
const context = { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000002' }) }
function request(method = 'GET', body?: unknown, origin = 'https://gcai.test') {
  return new Request('https://gcai.test/api/integrations/scisure/snapshots/00000000-0000-0000-0000-000000000002/workspace', { method, headers: { authorization: 'Bearer fixture-credential', 'x-gcai-bridge-session': '00000000-0000-0000-0000-000000000001', 'x-gcai-scisure-origin': 'https://sandbox.elabjournal.com', origin, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
}
async function routes() {
  expect(existsSync(resolve('app/api/integrations/scisure/snapshots/[id]/workspace/route.ts')), 'workspace GET route exists').toBe(true)
  return { get: (await import('@/app/api/integrations/scisure/snapshots/[id]/workspace/route')).GET, decide: (await import('@/app/api/integrations/scisure/snapshots/[id]/workspace/decisions/route')).POST, draft: (await import('@/app/api/integrations/scisure/snapshots/[id]/workspace/draft/route')).POST }
}
describe('private workspace routes (mocked persistence, real handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticatedPrincipal.mockResolvedValue({ id: 'principal-1', kind: 'registered', userId: 'owner-1', guestSubjectId: null })
    mocks.authorizeConnection.mockResolvedValue({ admin: { rpc: mocks.rpc }, connection: { id: workspace().bridgeSessionId, principal_id: 'principal-1', owner_user_id: 'owner-1' } })
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'gpc_record_scisure_workspace_decision' ? true : { ...workspace(), decisions: {} }, error: null }))
  })
  it('returns full four-finding analysis and private/no-store headers; pending is empty', async () => {
    const { get } = await routes()
    const response = await get(request(), context)
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store')
    const data = await response.json(); expect(data.analysis).toEqual(analysis()); expect(data.findings).toHaveLength(4)
    mocks.rpc.mockResolvedValueOnce({ data: { ...workspace(), status: 'queued', analysis: null, decisions: {} }, error: null })
    const pending = await (await get(request(), context)).json(); expect(pending.analysis).toBeNull(); expect(pending.findings).toEqual([])
  })
  it('requires real owner session, not a bearer or spoofed mailbox', async () => {
    const { get } = await routes()
    mocks.authenticatedPrincipal.mockResolvedValueOnce({ id: 'wrong', kind: 'registered', userId: 'owner-1' })
    expect((await get(request(), context)).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.authenticatedPrincipal.mockRejectedValueOnce(new Error('Unverified mailbox fixture-secret@example.test'))
    const response = await get(request(), context); expect(response.status).toBe(403); expect(await response.text()).not.toContain('fixture-secret')
  })
  it('fails closed on expired connection and missing verified guest admission', async () => {
    const { get } = await routes(); mocks.authorizeConnection.mockRejectedValueOnce(new Error('expired'))
    expect((await get(request(), context)).status).toBe(403)
    mocks.authenticatedPrincipal.mockRejectedValueOnce(new Error('guest gate unavailable'))
    expect((await get(request(), context)).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('allows existing verified guest identity only when principal and connection agree', async () => {
    const { get, decide } = await routes()
    mocks.authenticatedPrincipal.mockResolvedValue({ id: 'principal-1', kind: 'guest', userId: null, guestSubjectId: 'subject-1' })
    mocks.authorizeConnection.mockResolvedValue({ admin: { rpc: mocks.rpc }, connection: { id: workspace().bridgeSessionId, principal_id: 'principal-1', owner_user_id: null } })
    mocks.rpc.mockResolvedValueOnce({ data: { ...workspace(), principalKind: 'guest', analysisId: undefined, analysisRevision: 0, decisions: {} }, error: null })
    expect((await get(request(), context)).status).toBe(200)
    expect((await decide(request('POST', { findingId: 'finding-0', decision: 'accepted', sourceHash: workspace().sourceHash, analysisRevision: 0 }), context)).status).toBe(200)
    expect(mocks.rpc).toHaveBeenLastCalledWith('gpc_record_scisure_workspace_decision', expect.objectContaining({ p_reviewer_user_id: null, p_guest_subject_id: 'subject-1' }))
  })
  it('records all-finding decisions using session-derived identity and returns CAS conflict', async () => {
    const { decide } = await routes()
    const body = { findingId: 'finding-0', decision: 'accepted', sourceHash: workspace().sourceHash, analysisRevision: 1 }
    const response = await decide(request('POST', body), context); expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ findingId: 'finding-0', decision: 'accepted', analysisRevision: 1 })
    expect(mocks.rpc).toHaveBeenCalledWith('gpc_record_scisure_workspace_decision', { p_connection_id: workspace().bridgeSessionId, p_snapshot_id: workspace().snapshotId, p_principal_id: 'principal-1', p_reviewer_user_id: 'owner-1', p_guest_subject_id: null, p_finding_id: 'finding-0', p_decision: 'accepted', p_source_hash: workspace().sourceHash, p_analysis_revision: 1 })
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null }); expect((await decide(request('POST', body), context)).status).toBe(409)
  })
  it('rejects cross-origin, spoofed fields, malformed and oversize input before persistence', async () => {
    const { decide, draft } = await routes()
    const binding = { sourceHash: workspace().sourceHash, analysisRevision: 1 }
    expect((await decide(request('POST', { ...binding, findingId: 'finding-0', decision: 'accepted' }, 'https://attacker.test'), context)).status).toBe(403)
    for (const body of [{ ...binding, email: 'owner@example.test' }, { ...binding, analysisRevision: '1' }, { ...binding, recommendations: [] }, { sourceHash: 'bad', analysisRevision: 1 }, { ...binding, padding: 'x'.repeat(9000) }]) expect((await draft(request('POST', body), context)).status).toBe(400)
    const malformed = new Request(request('POST', binding), { body: '{' }); expect((await draft(malformed, context)).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('draft uses only current durable decisions and blocks incomplete or stale review', async () => {
    const { draft } = await routes(); const binding = { sourceHash: workspace().sourceHash, analysisRevision: 1 }
    expect((await draft(request('POST', binding), context)).status).toBe(409)
    mocks.rpc.mockResolvedValueOnce({ data: { ...workspace(), decisions: { 'finding-0': 'accepted', 'finding-1': 'rejected', 'finding-2': 'rejected', hypothesis: 'accepted' } }, error: null })
    const response = await draft(request('POST', binding), context); expect(response.status).toBe(200)
    const bundle = await response.json(); expect(bundle.draftText).toBe(workspace().source.protocolText); expect(bundle.appliedFindingIds).toEqual([])
    expect((await draft(request('POST', { ...binding, analysisRevision: 7 }), context)).status).toBe(409)
  })
  it('rejects malformed retention, source and model shapes without reflecting raw text', async () => {
    const { get } = await routes()
    for (const patch of [{ retentionExpiresAt: 'not-a-date' }, { sourceHash: 'malformed' }, { source: { ...workspace().source, protocolText: 'Spoofed procedure' } }, { analysis: { recommendations: [] } }]) {
      mocks.rpc.mockResolvedValueOnce({ data: { ...workspace(), ...patch, decisions: {} }, error: null })
      expect((await get(request(), context)).status).toBe(403)
    }
  })
  it('rejects arrays masquerading as decisions and SQL-overflow revisions before RPC', async () => {
    const { decide } = await routes()
    for (const patch of [{ decision: ['accepted'] }, { analysisRevision: 2147483648 }]) {
      const response = await decide(request('POST', { sourceHash: workspace().sourceHash, analysisRevision: 1, findingId: 'finding-0', decision: 'accepted', ...patch }), context)
      expect(response.status).toBe(400)
    }
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
