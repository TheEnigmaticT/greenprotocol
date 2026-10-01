import { NextResponse } from 'next/server'
import { authenticatedPrincipal, authorizeConnection } from './server'
import { parseSciSureAdmission } from './index'
import { workspaceFindings, prepareWorkspaceDraft } from './workspace'
import type { SciSureWorkspace, SciSureWorkspaceDecision } from './workspace-contract'

class WorkspaceError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Authorization' }
const invalid = () => new WorkspaceError(400, 'Invalid workspace request.')
export async function workspaceInput(request: Request, decision: boolean) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new WorkspaceError(403, 'Cross-site workspace writes are not accepted.')
  // Bound the actual streamed bytes; Content-Length is not a trusted size proof.
  const reader = request.body?.getReader()
  if (!reader) throw invalid()
  const chunks: Uint8Array[] = []; let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 4096) { await reader.cancel(); throw invalid() }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  let raw: Record<string, unknown>
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
    raw = value as Record<string, unknown>
  } catch { throw invalid() }
  const keys = decision ? ['sourceHash', 'analysisRevision', 'findingId', 'decision'] : ['sourceHash', 'analysisRevision']
  if (Object.keys(raw).length !== keys.length || keys.some(k => !Object.hasOwn(raw, k))) throw invalid()
  if (typeof raw.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sourceHash) || !Number.isSafeInteger(raw.analysisRevision) || (raw.analysisRevision as number) < 0 || (raw.analysisRevision as number) > 2147483647) throw invalid()
  if (decision && (typeof raw.findingId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(raw.findingId) || (raw.decision !== 'accepted' && raw.decision !== 'rejected'))) throw invalid()
  return { sourceHash: raw.sourceHash, analysisRevision: raw.analysisRevision as number, findingId: raw.findingId as string, decision: raw.decision as SciSureWorkspaceDecision }
}
async function owner(request: Request, snapshotId: string) {
  const bridgeSessionId = request.headers.get('x-gcai-bridge-session') || ''
  const authorization = request.headers.get('authorization') || ''
  const origin = request.headers.get('x-gcai-scisure-origin') || ''
  if (!UUID.test(snapshotId) || !UUID.test(bridgeSessionId) || !/^Bearer [A-Za-z0-9_-]{1,128}$/.test(authorization) || !origin) throw invalid()
  try {
    const { admin, connection } = await authorizeConnection({ bridgeSessionId, credential: authorization.slice(7), origin })
    const principal = await authenticatedPrincipal()
    if (connection.id !== bridgeSessionId || principal.id !== connection.principal_id
      || (principal.kind === 'registered' ? !principal.userId || principal.userId !== connection.owner_user_id : connection.owner_user_id !== null || !principal.guestSubjectId)) throw new Error('owner mismatch')
    return { admin, args: { p_connection_id: bridgeSessionId, p_snapshot_id: snapshotId, p_principal_id: principal.id, p_reviewer_user_id: principal.userId, p_guest_subject_id: principal.guestSubjectId } }
  } catch { throw new WorkspaceError(403, 'Workspace owner verification failed or the connection expired. Sign in as the owner; unverified guest recovery is unavailable.') }
}
async function load(access: Awaited<ReturnType<typeof owner>>) {
  const { data, error } = await access.admin.rpc('gpc_get_scisure_workspace' as never, access.args as never)
  if (error || !data) throw new WorkspaceError(403, 'Private workspace is unavailable or expired.')
  // Reconcile local runtime shape without changing the frozen shared contract.
  const raw = data as unknown as SciSureWorkspace & { decisions: Record<string, SciSureWorkspaceDecision> }
  const expiry = Date.parse(raw.retentionExpiresAt)
  if (raw.version !== 2 || raw.snapshotId !== access.args.p_snapshot_id || raw.bridgeSessionId !== access.args.p_connection_id || !UUID.test(raw.runId) || !/^[a-f0-9]{64}$/.test(raw.sourceHash) || raw.principalKind !== (access.args.p_reviewer_user_id ? 'registered' : 'guest') || !['queued', 'running', 'completed', 'failed', 'uncertain'].includes(raw.status) || !Number.isSafeInteger(raw.analysisRevision) || raw.analysisRevision < 0 || !raw.decisions || !Number.isFinite(expiry) || expiry <= Date.now()) throw new WorkspaceError(403, 'Malformed private workspace; no draft was prepared.')
  const imported = parseSciSureAdmission({ version: 1, type: 'scisure.gcai.admission', nonce: '0'.repeat(64), bridgeSessionId: raw.bridgeSessionId, requestId: raw.runId, source: raw.source })
  if (imported.sourceHash !== raw.sourceHash) throw new WorkspaceError(403, 'Private source binding changed.')
  if (raw.status === 'completed' && (!raw.analysis || !Array.isArray(raw.analysis.recommendations) || !Array.isArray(raw.analysis.steps) || typeof raw.analysis.protocolTitle !== 'string' || typeof raw.analysis.revisedProtocol !== 'string' || !raw.analysis.overallAssessment)) throw new WorkspaceError(403, 'Completed analysis is unavailable.')
  return { version: 2, bridgeSessionId: raw.bridgeSessionId, snapshotId: raw.snapshotId, sourceHash: raw.sourceHash, runId: raw.runId, status: raw.status, principalKind: raw.principalKind, ...(raw.analysisId ? { analysisId: raw.analysisId } : {}), analysisRevision: raw.analysisRevision, source: imported.source, retentionExpiresAt: raw.retentionExpiresAt, analysis: raw.status === 'completed' ? raw.analysis : null, findings: raw.status === 'completed' ? workspaceFindings(raw.analysis!, raw.decisions) : [] } satisfies SciSureWorkspace
}
export async function workspaceResponse(request: Request, context: { params: Promise<{ id: string }> }, mode: 'get' | 'decision' | 'draft') {
  try {
    const input = mode === 'get' ? null : await workspaceInput(request, mode === 'decision')
    const { id } = await context.params
    const access = await owner(request, id)
    if (mode === 'decision' && input) {
      const { data, error } = await access.admin.rpc('gpc_record_scisure_workspace_decision' as never, { ...access.args, p_finding_id: input.findingId, p_decision: input.decision, p_source_hash: input.sourceHash, p_analysis_revision: input.analysisRevision } as never)
      if (error) throw new WorkspaceError(503, 'Could not persist workspace review.')
      if (data !== true) throw new WorkspaceError(409, 'Source, finding or analysis revision changed; reload before reviewing.')
      return NextResponse.json({ findingId: input.findingId, decision: input.decision, analysisRevision: input.analysisRevision }, { headers })
    }
    const workspace = await load(access)
    if (mode === 'get') return NextResponse.json(workspace, { headers })
    try { return NextResponse.json(prepareWorkspaceDraft(workspace, input!), { headers }) }
    catch { throw new WorkspaceError(409, 'Draft unavailable: review every current finding, check source/revision, and keep the complete bundle within 256 KiB.') }
  } catch (error) {
    // Never reflect arbitrary database/model/auth exception text or credentials.
    return NextResponse.json({ error: error instanceof WorkspaceError ? error.message : 'Private workspace request failed.' }, { status: error instanceof WorkspaceError ? error.status : 403, headers })
  }
}
