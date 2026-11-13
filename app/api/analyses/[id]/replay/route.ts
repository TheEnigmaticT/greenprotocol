import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  replayFrozenScoring,
  SCORING_INPUT_MANIFEST_SCHEMA_VERSION,
  type ScoringInputManifest,
} from '@/lib/scoring-input-manifest'
import { getAnalysisMetadata } from '@/lib/version'
import { getScoringViewStatus } from '@/lib/scoring-view-status'

/**
 * GET /api/analyses/[id]/replay
 *
 * Returns the stored deterministic scores for an existing analysis from
 * the immutable scoring-input manifest embedded in the analysis record.
 * This is an audit / historical replay endpoint. It NEVER triggers a
 * fresh analysis or a refreshed score, and NEVER calls the chemistry
 * service or any model provider.
 *
 * Auth: the row's `user_id` must equal the authenticated user. Any other
 * owner (or missing row) returns 404 with a generic message that does not
 * disclose ownership details.
 *
 * The replay payload is metadata-only plus the stored scores. The
 * `digest` field is an integrity checksum, not a cryptographic signature
 * or authentication artifact.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Only the exact columns we need; no analysis_result fetches beyond what
  // is required to surface the manifest and original protocol text.
  const { data, error } = await supabase
    .from('gpc_analyses')
    .select('protocol_text,analysis_result')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 })
  }

  const analysisResult = (data.analysis_result ?? {}) as { scoringInputManifest?: unknown; analysisMetadata?: { generatedAt?: string } }
  const storedManifest = analysisResult.scoringInputManifest as
    | ScoringInputManifest
    | undefined

  if (!storedManifest || typeof storedManifest !== 'object') {
    return NextResponse.json(
      {
        error: 'Analysis has no preserved scoring inputs; cannot replay',
        code: 'manifest_missing',
      },
      { status: 409 },
    )
  }

  if (storedManifest.schemaVersion !== SCORING_INPUT_MANIFEST_SCHEMA_VERSION) {
    return NextResponse.json(
      {
        error: 'Stored manifest uses an unsupported schema version; cannot replay',
        code: 'schema_mismatch',
      },
      { status: 409 },
    )
  }

  const metadata = getAnalysisMetadata()

  try {
    const replay = replayFrozenScoring(storedManifest, {
      sourceText: data.protocol_text ?? '',
      // Historical retrieval validates the recorded method, not today's method.
      // Strict callers of replayFrozenScoring may still require an exact method.
      methodologyVersion: storedManifest.provenance?.methodologyVersion,
    })
    return NextResponse.json(
      {
        mode: replay.mode,
        recomputed: replay.recomputed,
        scores: replay.scores,
        metadata: {
          schemaVersion: storedManifest.schemaVersion,
          methodologyVersion: storedManifest.provenance.methodologyVersion,
          currentMethodologyVersion: metadata.methodologyVersion,
          methodologyDrifted: metadata.methodologyVersion !== storedManifest.provenance.methodologyVersion,
          recordRole: 'original-analysis',
          currentViewStatus: getScoringViewStatus(data.analysis_result),
          model: storedManifest.provenance.model,
          sourceHash: storedManifest.sourceHash,
          digest: storedManifest.digest,
          storedAnalysisGeneratedAt: typeof analysisResult.analysisMetadata?.generatedAt === 'string' ? analysisResult.analysisMetadata.generatedAt : null,
          replayMode: 'stored-result-replay',
          replayedAt: new Date().toISOString(),
        },
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'replay failed'
    let code = 'replay_failed'
    if (/sourceHash|source/i.test(message)) code = 'source_mismatch'
    else if (/methodology/i.test(message)) code = 'methodology_mismatch'
    else if (/digest/i.test(message)) code = 'digest_mismatch'
    else if (/schemaVersion/i.test(message)) code = 'schema_mismatch'
    else if (/provenance/i.test(message)) code = 'manifest_missing'
    return NextResponse.json({ error: 'Cannot replay stored result', code }, { status: 409 })
  }
}
