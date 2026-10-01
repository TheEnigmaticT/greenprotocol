import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { projectSciSureResult, type RawRecommendation } from '@/lib/integrations/scisure'
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
    const subjectId = await configuredGuestAdmissionService().subjectForAdmission((await cookies()).get('gcai_scisure_guest')?.value || '')
    if (!subjectId) throw new Error('Guest admission is required.')
    const { data: principal } = await admin.from('gpc_scisure_principals').select('id').eq('id', connection.principal_id).eq('kind', 'guest').eq('guest_subject_id', subjectId).maybeSingle()
    if (!principal) throw new Error('Guest admission does not own this connection.')
    const { data: snapshot, error: snapshotError } = await admin.from('gpc_external_source_snapshots').select('id, source_hash, source').eq('id', snapshotId).eq('connection_id', connection.id).eq('principal_id', connection.principal_id).maybeSingle()
    if (snapshotError || !snapshot || snapshot.source_hash !== body.sourceHash) throw new Error('This review does not match the admitted source hash.')
    const { data: job, error: jobError } = await admin.from('gpc_scisure_jobs').select('id, status, analysis_id, result').eq('snapshot_id', snapshot.id).eq('principal_id', connection.principal_id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (jobError || !job || job.status !== 'completed') throw new Error('A completed analysis is required before review.')
    let recommendations: RawRecommendation[] = []; let revision: number | null = null
    if (job.analysis_id) { const { data: analysis } = await admin.from('gpc_analyses').select('analysis_result, revision_number').eq('id', job.analysis_id).maybeSingle(); if (!analysis) throw new Error('Analysis result is unavailable.'); recommendations = Array.isArray(analysis.analysis_result?.recommendations) ? analysis.analysis_result.recommendations as RawRecommendation[] : []; revision = Number.isSafeInteger(analysis.revision_number) ? analysis.revision_number : null }
    else { recommendations = Array.isArray((job.result as { recommendations?: unknown } | null)?.recommendations) ? (job.result as { recommendations: RawRecommendation[] }).recommendations : [] }
    if (revision !== body.analysisRevision) throw new Error('This review does not match the current analysis revision.')
    const selection = Array.isArray((snapshot.source as { selection?: unknown } | null)?.selection) ? (snapshot.source as { selection: Array<{ stepId?: string; order: number }> }).selection : []
    const eligible = projectSciSureResult({ bridgeSessionId: connection.id, snapshotId: snapshot.id, sourceHash: snapshot.source_hash, runId: job.id, status: 'completed', revisionNumber: revision ?? undefined, selection, recommendations }).recommendations || []
    if (!eligible.some((item) => item.recommendationId === body.recommendationId)) throw new Error('This recommendation is not eligible for scientist review.')
    const { data: decision, error } = await admin.from('gpc_scisure_review_decisions').upsert({ job_id: job.id, recommendation_id: body.recommendationId, reviewer_principal_id: connection.principal_id, decision: body.decision }, { onConflict: 'job_id,recommendation_id' }).select('recommendation_id, decision').single()
    if (error || !decision) throw new Error('Could not record scientist decision.')
    return NextResponse.json({ recommendationId: decision.recommendation_id, decision: decision.decision, sourceHash: snapshot.source_hash, analysisRevision: revision }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { const message = error instanceof Error ? error.message : 'Guest scientist review unavailable.'; return NextResponse.json({ error: message }, { status: /Cross-site|Guest admission/.test(message) ? 403 : 400, headers: { 'Cache-Control': 'private, no-store' } }) }
}
