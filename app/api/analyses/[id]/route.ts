import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { calculateEquivalencies } from '@/lib/equivalencies'

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

  const equivalencies = calculateEquivalencies(data.impact_delta)

  return NextResponse.json({
    id: data.id,
    protocolText: data.protocol_text,
    analysis: data.analysis_result,
    impactDelta: data.impact_delta,
    revisionNumber: data.revision_number,
    equivalencies,
  })
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

  const body = await request.json() as {
    analysis_result?: unknown
    expected_revision_number?: unknown
  }
  const { analysis_result, expected_revision_number } = body

  if (!analysis_result || typeof expected_revision_number !== 'number' || !Number.isInteger(expected_revision_number) || expected_revision_number < 1) {
    return NextResponse.json({ error: 'analysis_result and expected_revision_number are required' }, { status: 400 })
  }

  const expectedRevisionNumber = expected_revision_number

  // Update analysis — user_id check ensures ownership
  const { data, error } = await supabase
    .from('gpc_analyses')
    .update({
      analysis_result,
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

  return NextResponse.json({ success: true, revisionNumber: data.revision_number })
}
