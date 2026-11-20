import { NextResponse } from 'next/server'
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
  if (request.headers.get('origin') !== requestOrigin) throw new Error('Cross-site decision requests are not accepted.')
}
function body(value: unknown): { recommendationId: string; decision: Decision; sourceHash: string; analysisRevision: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid review decision.')
  const input = value as Record<string, unknown>
  if (typeof input.recommendationId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(input.recommendationId)) throw new Error('Invalid recommendation.')
  if (input.decision !== 'approved_for_experiment' && input.decision !== 'rejected') throw new Error('Invalid scientist decision.')
  if (typeof input.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceHash)) throw new Error('Invalid source binding.')
  if (!Number.isSafeInteger(input.analysisRevision) || (input.analysisRevision as number) < 0) throw new Error('Invalid analysis revision binding.')
  return { recommendationId: input.recommendationId, decision: input.decision, sourceHash: input.sourceHash, analysisRevision: input.analysisRevision as number }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request)
    const { id: snapshotId } = await context.params
    const input = body(await request.json())
    const origin = requireSciSureOrigin(request.headers.get('x-gcai-scisure-origin'))
    const { admin, connection } = await authorizeConnection({ bridgeSessionId: request.headers.get('x-gcai-bridge-session') || '', credential: bearer(request), origin })
    if (!connection.owner_user_id) throw new Error('Guest scientist review is unavailable until a verified admission gate is configured.')
    const session = await createClient()
    const { data: { user } } = await session.auth.getUser()
    if (!user || user.id !== connection.owner_user_id) throw new Error('Sign in as the connection owner to review this result.')
    const { data, error } = await admin.rpc('gpc_record_scisure_review_decision' as never, {
      p_snapshot_id: snapshotId,
      p_principal_id: connection.principal_id,
      p_reviewer_user_id: user.id,
      p_recommendation_id: input.recommendationId,
      p_decision: input.decision,
      p_source_hash: input.sourceHash,
      p_analysis_revision: input.analysisRevision,
    } as never)
    if (error) throw new Error('Could not record scientist decision.')
    if (data !== true) throw new Error('This review no longer matches the completed eligible analysis.')
    return NextResponse.json({ recommendationId: input.recommendationId, decision: input.decision, sourceHash: input.sourceHash, analysisRevision: input.analysisRevision }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scientist review is unavailable.'
    const status = message.startsWith('Cross-site') || message.startsWith('Sign in') || message.startsWith('Guest') ? 403 : 400
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
