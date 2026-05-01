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

  // Parse the request body
  const body = await request.json()
  const { analysis_result } = body

  if (!analysis_result) {
    return NextResponse.json({ error: 'Missing analysis_result' }, { status: 400 })
  }

  // Update analysis — user_id check ensures ownership
  const { data, error } = await supabase
    .from('gpc_analyses')
    .update({ analysis_result })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to update analysis' }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
