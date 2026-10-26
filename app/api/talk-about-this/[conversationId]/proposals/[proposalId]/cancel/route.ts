import { talkActionFailure } from '@/lib/talk-about-this/action-errors'
import { cancelProcedureProposal } from '@/lib/talk-about-this/repository'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

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
    await cancelProcedureProposal(supabase, { conversationId, proposalId })
    return Response.json({ proposalId, status: 'cancelled' })
  } catch (error) {
    console.error('Procedure proposal cancel failed', { conversationId, proposalId, error })
    const failure = talkActionFailure(error, 'proposal')
    return Response.json({ error: failure.message, code: failure.code }, { status: failure.status })
  }
}
