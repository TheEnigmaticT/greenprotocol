import { NextResponse } from 'next/server'
import { projectSciSureResult, type RawRecommendation, type SciSureReviewDecision } from '@/lib/integrations/scisure'
import { authorizeConnection, requireSciSureOrigin } from '@/lib/integrations/scisure/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const credential = request.headers.get('authorization')?.replace(/^Bearer /, '')
    if (!credential) throw new Error('Missing connection credential.')
    const { admin, connection } = await authorizeConnection({ bridgeSessionId: request.headers.get('x-gcai-bridge-session') || '', credential, origin: requireSciSureOrigin(request.headers.get('x-gcai-scisure-origin')) })
    const { data: snapshot, error: snapshotError } = await admin.from('gpc_external_source_snapshots').select('id, source_hash, source').eq('id', id).eq('connection_id', connection.id).maybeSingle()
    if (snapshotError || !snapshot) throw new Error('Snapshot not found.')
    const { data: job, error: jobError } = await admin.from('gpc_scisure_jobs').select('id, status, analysis_id, analysis_run_id, result').eq('snapshot_id', snapshot.id).eq('principal_id', connection.principal_id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (jobError || !job) throw new Error('Analysis job not found.')
    let recommendations: RawRecommendation[] = []
    let revisionNumber: number | undefined
    if (job.status === 'completed' && job.analysis_id) {
      const { data: analysis } = await admin.from('gpc_analyses').select('analysis_result, revision_number').eq('id', job.analysis_id).maybeSingle()
      recommendations = Array.isArray(analysis?.analysis_result?.recommendations) ? analysis.analysis_result.recommendations as RawRecommendation[] : []
      revisionNumber = analysis?.revision_number
    } else if (job.status === 'completed') {
      const result = job.result as { recommendations?: unknown } | null
      recommendations = Array.isArray(result?.recommendations) ? result.recommendations as RawRecommendation[] : []
    }
    let reviewDecisions: Record<string, SciSureReviewDecision> | undefined
    if (job.status === 'completed') {
      const { data: decisions, error: decisionsError } = await admin.from('gpc_scisure_review_decisions').select('recommendation_id, decision').eq('job_id', job.id)
      if (decisionsError) throw new Error('Scientist review decisions are unavailable.')
      reviewDecisions = Object.fromEntries((decisions || []).flatMap((decision) => (
        typeof decision.recommendation_id === 'string' && (decision.decision === 'approved_for_experiment' || decision.decision === 'rejected')
          ? [[decision.recommendation_id, decision.decision]] : []
      ))) as Record<string, SciSureReviewDecision>
    }
    const selection = Array.isArray((snapshot.source as { selection?: unknown } | null)?.selection) ? (snapshot.source as { selection: Array<{ stepId?: string; order: number }> }).selection : []
    return NextResponse.json(projectSciSureResult({ bridgeSessionId: connection.id, snapshotId: snapshot.id, sourceHash: snapshot.source_hash, runId: job.id, status: job.status, analysisId: job.analysis_id || undefined, revisionNumber, selection, recommendations, reviewDecisions }), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Status unavailable.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
