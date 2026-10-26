import { talkActionFailure } from '@/lib/talk-about-this/action-errors'
import { applyProcedureProposal } from '@/lib/talk-about-this/repository'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * The scientist pressed Apply on a reviewed proposal. This confirms it and returns the edited
 * text; it does NOT touch the saved analysis and does NOT run an analysis. The caller re-runs
 * the returned text as a new analysis.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string; proposalId: string }> },
) {
  const { conversationId, proposalId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Please sign in to use chat.', code: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await applyProcedureProposal(supabase, { conversationId, proposalId })
    if (result.outcome === 'stale') {
      return Response.json({
        error: 'The saved procedure changed after this was proposed, so the proposal is out of date. Ask for a new one.',
        code: 'procedure_changed',
      }, { status: 409 })
    }
    return Response.json({
      proposalId: result.proposalId,
      summary: result.summary,
      proposedText: result.proposedText,
    })
  } catch (error) {
    console.error('Procedure proposal apply failed', { conversationId, proposalId, error })
    const failure = talkActionFailure(error, 'proposal')
    return Response.json({ error: failure.message, code: failure.code }, { status: failure.status })
  }
}
