import { NextResponse } from 'next/server'
import { buildTalkAboutContext, parseTalkAboutScope } from '@/lib/talk-about-this/context'
import type { TalkAboutContext } from '@/lib/talk-about-this/context'
import type { TalkAboutScope } from '@/lib/talk-about-this/context'
import {
  conversationHistoryForUi,
  createConversation,
  evidenceReceiptsForUi,
  findOwnedConversationByContextHash,
  listConversationMessages,
  loadOwnedAnalysis,
  listPendingProcedureProposals,
  loadOwnedRecommendationDecisionReceipt,
} from '@/lib/talk-about-this/repository'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Please sign in to use chat.', code: 'unauthorized' }, { status: 401 })
  }

  let analysisId: string
  let scope: TalkAboutScope
  let newConversation: boolean
  try {
    const body = await request.json() as { analysisId?: unknown; scope?: unknown; newConversation?: unknown }
    if (typeof body.analysisId !== 'string' || !body.analysisId) {
      return NextResponse.json({ error: 'Chat needs a saved analysis to talk about. Save or reopen the analysis first.', code: 'analysis_required' }, { status: 400 })
    }
    if (body.newConversation !== undefined && typeof body.newConversation !== 'boolean') {
      return NextResponse.json({ error: 'We could not start that chat. Please try again.', code: 'invalid_request' }, { status: 400 })
    }
    analysisId = body.analysisId
    scope = parseTalkAboutScope(body.scope)
    newConversation = body.newConversation === true
  } catch (error) {
    console.error('Invalid chat open request', error)
    return NextResponse.json({ error: 'We could not start a chat about that. Please try again.', code: 'invalid_request' }, { status: 400 })
  }

  try {
    const analysis = await loadOwnedAnalysis(supabase, user.id, analysisId)
    if (!analysis) {
      return NextResponse.json({ error: 'We could not find that analysis. It may have been deleted.', code: 'analysis_not_found' }, { status: 404 })
    }

    let context: TalkAboutContext
    try {
      context = buildTalkAboutContext({
        analysisId,
        protocolText: analysis.protocol_text,
        analysis: analysis.analysis_result,
        scope,
      })
    } catch (error) {
      console.error('Chat scope does not match the saved analysis', error)
      return NextResponse.json({
        error: 'That part of the analysis is no longer available, so chat could not open for it. Reload the analysis and try again.',
        code: 'scope_unavailable',
      }, { status: 400 })
    }
    const existingConversation = newConversation
      ? null
      : await findOwnedConversationByContextHash(
        supabase,
        user.id,
        analysisId,
        context.contextHash,
      )
    const conversation = existingConversation ?? await createConversation(supabase, user.id, analysisId, scope, context)
    const messages = await listConversationMessages(supabase, user.id, conversation.id)
    const decisionReceipt = await loadOwnedRecommendationDecisionReceipt(supabase, user.id, conversation.id)
    const proposals = await listPendingProcedureProposals(supabase, user.id, conversation.id)

    return NextResponse.json({
      conversationId: conversation.id,
      scope: conversation.scope,
      contextHash: conversation.context_hash,
      noDirectEvidence: context.noDirectEvidence,
      disposition: existingConversation ? 'resumed' : 'created',
      messages: conversationHistoryForUi(messages),
      evidenceReceipts: evidenceReceiptsForUi(messages),
      decisionReceipt,
      proposals,
    }, { status: existingConversation ? 200 : 201 })
  } catch (error) {
    console.error('Failed to open chat', error)
    return NextResponse.json({ error: 'We could not open the chat. Please try again.', code: 'open_failed' }, { status: 500 })
  }
}
