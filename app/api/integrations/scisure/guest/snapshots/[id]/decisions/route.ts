import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { configuredGuestAdmissionService } from '@/lib/integrations/scisure/guest-server'
import { authorizeConnection, requireSciSureOrigin } from '@/lib/integrations/scisure/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Decision = 'approved_for_experiment' | 'rejected'
function bearer(request: Request) { const value = request.headers.get('authorization') || ''; if (!value.startsWith('Bearer ') || value.length > 1024) throw new Error('Missing connection credential.'); return value.slice(7) }
function sameOrigin(request: Request) { if (request.headers.get('origin') !== new URL(request.url).origin) throw new Error('Cross-site decision requests are not accepted.') }
function input(value: unknown): { recommendationId: string; decision: Decision; sourceHash: string; analysisRevision: number | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid review decision.')
  const body = value as Record<string, unknown>
  if (typeof body.recommendationId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(body.recommendationId)) throw new Error('Invalid recommendation.')
  if (body.decision !== 'approved_for_experiment' && body.decision !== 'rejected') throw new Error('Invalid scientist decision.')
  if (typeof body.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.sourceHash)) throw new Error('Invalid source binding.')
  if (body.analysisRevision !== null && (!Number.isSafeInteger(body.analysisRevision) || (body.analysisRevision as number) < 0)) throw new Error('Invalid analysis revision binding.')
  return { recommendationId: body.recommendationId, decision: body.decision, sourceHash: body.sourceHash, analysisRevision: body.analysisRevision as number | null }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request)
    const body = input(await request.json()); const { id: snapshotId } = await context.params
    const origin = requireSciSureOrigin(request.headers.get('x-gcai-scisure-origin'))
    const { admin, connection } = await authorizeConnection({ bridgeSessionId: request.headers.get('x-gcai-bridge-session') || '', credential: bearer(request), origin })
    const jar = await cookies()
    const subjectId = await configuredGuestAdmissionService().subjectForAdmission(jar.get('gcai_scisure_guest')?.value || '', jar.get('gcai_scisure_guest_binding')?.value)
    if (!subjectId) throw new Error('Guest admission is required.')
    const { data: principal } = await admin.from('gpc_scisure_principals').select('id').eq('id', connection.principal_id).eq('kind', 'guest').eq('guest_subject_id', subjectId).maybeSingle()
    if (!principal) throw new Error('Guest admission does not own this connection.')
    const { data: snapshot, error: snapshotError } = await admin.from('gpc_external_source_snapshots').select('id, source_hash, source').eq('id', snapshotId).eq('connection_id', connection.id).eq('principal_id', connection.principal_id).maybeSingle()
    if (snapshotError || !snapshot || snapshot.source_hash !== body.sourceHash) throw new Error('This review does not match the admitted source hash.')
    if (body.analysisRevision !== null) throw new Error('Guest results cannot use an account analysis revision.')
    const { data: recorded, error } = await admin.rpc('gpc_record_scisure_guest_review_decision' as never, {
      p_snapshot_id: snapshot.id, p_principal_id: connection.principal_id, p_subject_id: subjectId,
      p_recommendation_id: body.recommendationId, p_decision: body.decision, p_source_hash: body.sourceHash,
    } as never)
    if (error) throw new Error('Could not record scientist decision.')
    if (recorded !== true) throw new Error('This review no longer matches the completed eligible guest result.')
    return NextResponse.json({ recommendationId: body.recommendationId, decision: body.decision, sourceHash: snapshot.source_hash, analysisRevision: null }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { const message = error instanceof Error ? error.message : 'Guest scientist review unavailable.'; return NextResponse.json({ error: message }, { status: /Cross-site|Guest admission/.test(message) ? 403 : 400, headers: { 'Cache-Control': 'private, no-store' } }) }
}
