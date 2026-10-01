import { NextResponse } from 'next/server'
import { projectSciSureResult, type RawRecommendation } from '@/lib/integrations/scisure'
import { authorizeConnection, requireSciSureOrigin } from '@/lib/integrations/scisure/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Decision = 'approved_for_experiment' | 'rejected'

function bearer(request: Request) {
  const value = request.headers.get('authorization') || ''
  if (!value.startsWith('Bearer ') || value.length > 1024) throw new Error('Missing connection credential.')
  return value.slice(7)
}

function requireSameOrigin(request: Request) {
  const requestOrigin = new URL(request.url).origin
  const origin = request.headers.get('origin')
  if (origin !== requestOrigin) throw new Error('Cross-site decision requests are not accepted.')
}

function body(value: unknown): { recommendationId: string; decision: Decision; sourceHash: string; analysisRevision: number | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid review decision.')
  const input = value as Record<string, unknown>
  if (typeof input.recommendationId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(input.recommendationId)) throw new Error('Invalid recommendation.')
  if (input.decision !== 'approved_for_experiment' && input.decision !== 'rejected') throw new Error('Invalid scientist decision.')
  if (typeof input.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceHash)) throw new Error('Invalid source binding.')
  if (input.analysisRevision !== null && (!Number.isSafeInteger(input.analysisRevision) || (input.analysisRevision as number) < 0)) throw new Error('Invalid analysis revision binding.')
  return { recommendationId: input.recommendationId, decision: input.decision, sourceHash: input.sourceHash, analysisRevision: input.analysisRevision as number | null }
}

async function resultForJob(admin: Awaited<ReturnType<typeof authorizeConnection>>['admin'], job: { id: string; status: string; analysis_id: string | null; result: unknown }) {
  let recommendations: RawRecommendation[] = []
  let analysisRevision: number | null = null
  if (job.analysis_id) {
    const { data: analysis, error } = await admin.from('gpc_analyses').select('analysis_result, revision_number').eq('id', job.analysis_id).maybeSingle()
    if (error || !analysis) throw new Error('Analysis result is unavailable.')
    recommendations = Array.isArray(analysis.analysis_result?.recommendations) ? analysis.analysis_result.recommendations as RawRecommendation[] : []
    analysisRevision = Number.isSafeInteger(analysis.revision_number) ? analysis.revision_number : null
  } else {
    const result = job.result as { recommendations?: unknown } | null
    recommendations = Array.isArray(result?.recommendations) ? result.recommendations as RawRecommendation[] : []
  }
  return { recommendations, analysisRevision }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request)
    const { id: snapshotId } = await context.params
    const input = body(await request.json())
    const origin = requireSciSureOrigin(request.headers.get('x-gcai-scisure-origin'))
    const { admin, connection } = await authorizeConnection({
      bridgeSessionId: request.headers.get('x-gcai-bridge-session') || '', credential: bearer(request), origin,
    })
    if (!connection.owner_user_id) throw new Error('Guest scientist review is unavailable until a verified admission gate is configured.')
    const session = await createClient()
    const { data: { user } } = await session.auth.getUser()
    if (!user || user.id !== connection.owner_user_id) throw new Error('Sign in as the connection owner to review this result.')

    const { data: snapshot, error: snapshotError } = await admin.from('gpc_external_source_snapshots')
      .select('id, source_hash, source').eq('id', snapshotId).eq('connection_id', connection.id).maybeSingle()
    if (snapshotError || !snapshot) throw new Error('Snapshot not found.')
    if (snapshot.source_hash !== input.sourceHash) throw new Error('This review does not match the admitted source hash.')

    const { data: job, error: jobError } = await admin.from('gpc_scisure_jobs')
      .select('id, status, analysis_id, result').eq('snapshot_id', snapshot.id).eq('principal_id', connection.principal_id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (jobError || !job || job.status !== 'completed') throw new Error('A completed analysis is required before review.')

    const result = await resultForJob(admin, job)
    if (result.analysisRevision !== input.analysisRevision) throw new Error('This review does not match the current analysis revision.')
    const selection = Array.isArray((snapshot.source as { selection?: unknown } | null)?.selection) ? (snapshot.source as { selection: Array<{ stepId?: string; order: number }> }).selection : []
    const eligible = projectSciSureResult({ bridgeSessionId: connection.id, snapshotId: snapshot.id, sourceHash: snapshot.source_hash, runId: job.id, status: 'completed', revisionNumber: result.analysisRevision ?? undefined, selection, recommendations: result.recommendations }).recommendations || []
    if (!eligible.some((recommendation) => recommendation.recommendationId === input.recommendationId)) throw new Error('This recommendation is not eligible for scientist review.')

    const { data: decision, error: decisionError } = await admin.from('gpc_scisure_review_decisions').upsert({
      job_id: job.id,
      recommendation_id: input.recommendationId,
      reviewer_user_id: user.id,
      decision: input.decision,
    }, { onConflict: 'job_id,recommendation_id' }).select('recommendation_id, decision').single()
    if (decisionError || !decision) throw new Error('Could not record scientist decision.')
    return NextResponse.json({ recommendationId: decision.recommendation_id, decision: decision.decision, sourceHash: snapshot.source_hash, analysisRevision: result.analysisRevision }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scientist review is unavailable.'
    const status = message.startsWith('Cross-site') || message.startsWith('Sign in') || message.startsWith('Guest') ? 403 : 400
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
