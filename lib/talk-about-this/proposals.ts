import type { SupabaseClient } from '@supabase/supabase-js'
import { applyProcedureEdits, hashProcedureText } from '@/lib/talk-about-this/procedure-edit'
import { parseProcedureProposal, type ProcedureProposal } from '@/lib/talk-about-this/procedure-proposal'
import { createProcedureProposal, loadOwnedAnalysis, type TalkConversation } from '@/lib/talk-about-this/repository'
import { canProposeProcedureEdit } from '@/lib/talk-about-this/scope'
import type { ProposalToolCall, ToolResult } from '@/lib/talk-about-this/tools'

const PROPOSAL_SOURCE = 'GC.ai procedure editor'

export const PROPOSED_NOT_APPLIED_NOTICE = 'PROPOSED, NOT APPLIED. The scientist must review the diff and press “Apply and re-run analysis” in the chat. Applying creates a new analysis and uses one analysis run; the current analysis stays unchanged. Do not say the procedure was changed or re-analysed.'

function proposalResult(
  status: ToolResult['status'],
  data: Record<string, unknown>,
  warnings: string[] = [],
): ToolResult {
  return { operation: 'procedure_proposal', chemical_name: '', status, source: PROPOSAL_SOURCE, data, citations: [], warnings }
}

/** What the model is told about a proposal: identity and summary, never the full text or diff. */
export function proposalResultForModel(result: ToolResult): ToolResult {
  const proposal = parseProcedureProposal(result.data.proposal)
  if (result.operation !== 'procedure_proposal' || !proposal) return result
  return {
    ...result,
    data: {
      status: result.data.status,
      proposalId: proposal.proposalId,
      summary: proposal.summary,
      message: result.data.message,
    },
  }
}

export function proposalFromResult(result: ToolResult): ProcedureProposal | null {
  return result.operation === 'procedure_proposal' && result.status === 'ok'
    ? parseProcedureProposal(result.data.proposal)
    : null
}

/**
 * Validates the model's edits against the FULL saved procedure (the chat snapshot is
 * truncated), stores a pending proposal, and reports it as proposed-not-applied.
 */
export async function executeProposalTool(input: {
  supabase: SupabaseClient
  userId: string
  conversation: Pick<TalkConversation, 'id' | 'analysis_id' | 'scope'>
  call: ProposalToolCall
}): Promise<ToolResult> {
  if (!canProposeProcedureEdit(input.conversation.scope)) {
    return proposalResult('unavailable', { status: 'not_proposed' }, ['This discussion is read-only and cannot propose procedure edits.'])
  }

  const analysis = await loadOwnedAnalysis(input.supabase, input.userId, input.conversation.analysis_id)
  if (!analysis) {
    return proposalResult('unavailable', { status: 'not_proposed' }, ['The saved analysis could not be loaded.'])
  }

  const edited = applyProcedureEdits(analysis.protocol_text, input.call.edits)
  if (!edited.ok) {
    return proposalResult('not_found', {
      status: 'not_proposed',
      reason: edited.failure.message,
      ...(edited.failure.editIndex === undefined ? {} : { editNumber: edited.failure.editIndex + 1 }),
    }, [edited.failure.message])
  }

  const stored = await createProcedureProposal(input.supabase, {
    conversationId: input.conversation.id,
    summary: input.call.summary,
    proposedText: edited.proposedText,
    diff: edited.diff,
    baseTextHash: hashProcedureText(analysis.protocol_text),
  })

  const proposal: ProcedureProposal = {
    proposalId: stored.proposalId,
    summary: input.call.summary,
    diff: edited.diff,
    proposedText: edited.proposedText,
    baseRevisionNumber: stored.baseRevisionNumber,
  }
  return proposalResult('ok', { status: 'proposed_not_applied', message: PROPOSED_NOT_APPLIED_NOTICE, proposal })
}
