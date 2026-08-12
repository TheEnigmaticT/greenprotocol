import { NextResponse } from 'next/server'
import { buildTalkAboutContext, parseTalkAboutScope } from '@/lib/talk-about-this/context'
import type { TalkAboutScope } from '@/lib/talk-about-this/context'
import { createConversation, findOwnedConversationByContextHash, loadOwnedAnalysis, loadOwnedRecommendationApprovalReceipt } from '@/lib/talk-about-this/repository'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let analysisId: string
  let scope: TalkAboutScope
  try {
    const body = await request.json() as { analysisId?: unknown; scope?: unknown }
    if (typeof body.analysisId !== 'string' || !body.analysisId) {
      return NextResponse.json({ error: 'analysisId is required' }, { status: 400 })
    }
    analysisId = body.analysisId
    scope = parseTalkAboutScope(body.scope)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid request body' }, { status: 400 })
  }

  try {
    const analysis = await loadOwnedAnalysis(supabase, user.id, analysisId)
    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 })
    }

    const context = buildTalkAboutContext({
      analysisId,
      protocolText: analysis.protocol_text,
      analysis: analysis.analysis_result,
      scope,
    })
    const existingConversation = await findOwnedConversationByContextHash(
      supabase,
      user.id,
      analysisId,
      context.contextHash,
    )
    const conversation = existingConversation ?? await createConversation(supabase, user.id, analysisId, scope, context)
    const approvalReceipt = await loadOwnedRecommendationApprovalReceipt(supabase, user.id, conversation.id)

    return NextResponse.json({
      conversationId: conversation.id,
      scope: conversation.scope,
      contextHash: conversation.context_hash,
      noDirectEvidence: context.noDirectEvidence,
      approvalReceipt,
    }, { status: existingConversation ? 200 : 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create conversation'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
