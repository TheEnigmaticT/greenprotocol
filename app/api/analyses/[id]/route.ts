import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { calculateEquivalencies } from '@/lib/equivalencies'
import { preserveStoredManifestOnPatch } from '@/lib/scoring-input-manifest'
import { getScoringViewStatus } from '@/lib/scoring-view-status'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('gpc_analyses')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 })
  }

  // Integration analyses may have no calculated impact; missing data is not zero savings.
  const equivalencies = data.impact_delta ? calculateEquivalencies(data.impact_delta) : []

  return NextResponse.json({
    id: data.id,
    protocolText: data.protocol_text,
    analysis: data.analysis_result,
    scoringAudit: getScoringViewStatus(data.analysis_result),
    impactDelta: data.impact_delta,
    revisionNumber: data.revision_number,
    scisureReview: Boolean(data.source_snapshot_hash),
    equivalencies,
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed: unknown = await request.json().catch(() => null)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'A JSON object is required' }, { status: 400 })
  }
  const body = parsed as {
    analysis_result?: unknown
    expected_revision_number?: unknown
  }
  const { analysis_result, expected_revision_number } = body

  if (!analysis_result || typeof analysis_result !== 'object' || Array.isArray(analysis_result) || typeof expected_revision_number !== 'number' || !Number.isInteger(expected_revision_number) || expected_revision_number < 1) {
    return NextResponse.json({ error: 'analysis_result and expected_revision_number are required' }, { status: 400 })
  }

  const expectedRevisionNumber = expected_revision_number
  const nextResult = analysis_result as Record<string, unknown>
  for (const field of ['steps', 'recommendations', 'inputWarnings']) {
    if (nextResult[field] !== undefined && !Array.isArray(nextResult[field])) {
      return NextResponse.json({ error: `${field} must be an array` }, { status: 400 })
    }
  }
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  const scores = nextResult.deterministicScores
  if (scores !== undefined && scores !== null && (!object(scores) || !Array.isArray(scores.scores)
    || typeof scores.grade !== 'string' || !finite(scores.total_score) || !finite(scores.max_possible)
    || !scores.scores.every(score => object(score) && finite(score.principle_number) && finite(score.score)
      && finite(score.max_score) && finite(score.normalized) && typeof score.confidence === 'string'))) {
    return NextResponse.json({ error: 'deterministicScores must be a valid score object' }, { status: 400 })
  }
  if (nextResult.wasteAnalysis !== undefined && nextResult.wasteAnalysis !== null && !object(nextResult.wasteAnalysis)) {
    return NextResponse.json({ error: 'wasteAnalysis must be an object' }, { status: 400 })
  }

  // Read the current owned record so we can preserve the immutable
  // scoringInputManifest and detect tampering before any write.
  const { data: currentRow, error: selectError } = await supabase
    .from('gpc_analyses')
    .select('analysis_result,revision_number')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (selectError) {
    return NextResponse.json({ error: 'Unable to load analysis' }, { status: 500 })
  }
  if (!currentRow) {
    // Same opaque message used elsewhere so we do not disclose ownership
    // of an analysis the caller does not own.
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 })
  }

  const currentRevisionNumber = currentRow.revision_number ?? 0
  if (currentRevisionNumber !== expectedRevisionNumber) {
    return NextResponse.json(
      { error: 'Analysis was updated elsewhere; reload before saving again', code: 'revision_mismatch' },
      { status: 409 },
    )
  }

  // Manifest preservation / tampering gate. This never alters any field
  // outside scoringInputManifest. The PATCH digest is an integrity
  // checksum, NOT a cryptographic signature or authentication artifact.
  const merge = preserveStoredManifestOnPatch(currentRow.analysis_result, nextResult)
  if (!merge.ok) {
    if (merge.code === 'manifest_shape_invalid') {
      return NextResponse.json(
        { error: 'scoringInputManifest is not a valid manifest shape', code: merge.code },
        { status: 400 },
      )
    }
    return NextResponse.json(
      {
        error:
          merge.code === 'manifest_tamper_forged'
            ? 'Cannot add or replace the immutable scoring inputs on this analysis'
            : 'scoringInputManifest does not match the stored immutable record',
        code: merge.code,
      },
      { status: 409 },
    )
  }

  // Update analysis — user_id check ensures ownership; revision_number
  // CAS keeps the existing optimistic-locking contract.
  const { data, error } = await supabase
    .from('gpc_analyses')
    .update({
      analysis_result: merge.mergedResult,
      revision_number: expectedRevisionNumber + 1,
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('revision_number', expectedRevisionNumber)
    .select('id, revision_number')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to update analysis' }, { status: 500 })
  }

  if (!data) {
    const { data: current, error: lookupError } = await supabase
      .from('gpc_analyses')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (lookupError || !current) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 })
    }

    return NextResponse.json({ error: 'Analysis was updated elsewhere; reload before saving again' }, { status: 409 })
  }

  return NextResponse.json({ success: true, revisionNumber: data.revision_number, scoringAudit: getScoringViewStatus(merge.mergedResult) })
}
