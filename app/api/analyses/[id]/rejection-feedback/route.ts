import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateRejectionFeedbackSubmission } from '@/lib/rejection-feedback'
import type { AnalysisResult } from '@/lib/types'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: analysisId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const validation = validateRejectionFeedbackSubmission(body)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const { submission } = validation
  const { data: analysis, error: analysisError } = await supabase
    .from('gpc_analyses')
    .select('analysis_result')
    .eq('id', analysisId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (analysisError) {
    return NextResponse.json({ error: 'Unable to verify the analysis' }, { status: 500 })
  }
  if (!analysis) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 })
  }

  const recommendations = (analysis.analysis_result as AnalysisResult).recommendations
  const recommendation = recommendations[submission.recommendationIndex]
  if (!recommendation || (submission.recommendationId && recommendation.id !== submission.recommendationId)) {
    return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 })
  }

  const { data: feedback, error: insertError } = await supabase
    .from('gpc_recommendation_rejection_feedback')
    .insert({
      analysis_id: analysisId,
      user_id: user.id,
      recommendation_id: recommendation.id ?? null,
      recommendation_index: submission.recommendationIndex,
      reason: submission.reason,
    })
    .select('id, created_at')
    .single()

  if (insertError || !feedback) {
    return NextResponse.json({ error: 'Unable to save feedback' }, { status: 500 })
  }

  return NextResponse.json({
    id: feedback.id,
    createdAt: feedback.created_at,
  }, { status: 201 })
}
