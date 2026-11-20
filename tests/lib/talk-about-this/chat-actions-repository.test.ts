import { describe, expect, it, vi } from 'vitest'
import { TalkActionError } from '@/lib/talk-about-this/action-errors'
import {
  applyProcedureProposal,
  cancelProcedureProposal,
  createProcedureProposal,
  listPendingProcedureProposals,
  loadOwnedRecommendationDecisionReceipt,
} from '@/lib/talk-about-this/repository'

/** A chainable query builder whose terminal call resolves to `result`. */
function query(result: unknown) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'eq', 'order', 'limit']) builder[method] = vi.fn().mockReturnValue(builder)
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  builder.then = vi.fn((resolve: (value: unknown) => void) => resolve(result))
  return builder
}

describe('loadOwnedRecommendationDecisionReceipt', () => {
  it('asks for the latest completed decision by its monotonic sequence, so approve→reject→approve shows the last one', async () => {
    const builder = query({
      data: {
        id: 'action-3',
        action_type: 'approve_recommendation',
        target_recommendation_id: 'rec-1',
        label: 'Use ethyl acetate',
        already_applied: false,
        revision_number: 6,
        completed_at: '2026-10-26T00:00:00.000Z',
      },
      error: null,
    })
    const from = vi.fn().mockReturnValue(builder)

    const receipt = await loadOwnedRecommendationDecisionReceipt({ from } as never, 'user-1', 'conversation-1')

    expect(from).toHaveBeenCalledWith('gpc_talk_actions')
    expect(builder.eq).toHaveBeenCalledWith('conversation_id', 'conversation-1')
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(builder.eq).toHaveBeenCalledWith('status', 'completed')
    expect(builder.order).toHaveBeenCalledWith('decision_sequence', { ascending: false })
    expect(builder.limit).toHaveBeenCalledWith(1)
    expect(receipt).toMatchObject({ actionId: 'action-3', decision: 'approved', revisionNumber: 6 })
  })

  it('returns null when nothing was decided and surfaces a load failure', async () => {
    expect(await loadOwnedRecommendationDecisionReceipt({ from: () => query({ data: null, error: null }) } as never, 'u', 'c')).toBeNull()
    await expect(loadOwnedRecommendationDecisionReceipt({ from: () => query({ data: null, error: { message: 'x' } }) } as never, 'u', 'c')).rejects.toThrow('decision receipt')
  })
})

describe('listPendingProcedureProposals', () => {
  it('returns only the caller’s pending proposals in client shape, newest first', async () => {
    const builder = query({
      data: [{ id: 'p-2', summary: 'Newer', diff: '@@ -1 +1 @@\n-a\n+b', proposed_text: 'edited text', base_revision_number: 3 }],
      error: null,
    })
    const supabase = { from: vi.fn().mockReturnValue(builder) }

    const proposals = await listPendingProcedureProposals(supabase as never, 'user-1', 'conversation-1')

    expect(supabase.from).toHaveBeenCalledWith('gpc_talk_proposals')
    expect(builder.eq).toHaveBeenCalledWith('status', 'pending')
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(proposals).toEqual([{ proposalId: 'p-2', summary: 'Newer', diff: '@@ -1 +1 @@\n-a\n+b', proposedText: 'edited text', baseRevisionNumber: 3 }])
  })

  it('drops rows that fail validation instead of showing a broken card', async () => {
    const supabase = { from: () => query({ data: [{ id: 'p-1', summary: '', diff: 'x', proposed_text: 'y', base_revision_number: 1 }], error: null }) }

    expect(await listPendingProcedureProposals(supabase as never, 'u', 'c')).toEqual([])
  })
})

describe('proposal RPC wrappers', () => {
  const input = { conversationId: 'conversation-1', proposalId: 'proposal-1' }

  it('creates a proposal through the definer RPC with the server-computed text, diff and base hash', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ proposal_id: 'p-1', base_revision_number: 4 }], error: null })

    const created = await createProcedureProposal({ rpc } as never, {
      conversationId: 'conversation-1',
      summary: 'Swap',
      proposedText: 'edited',
      diff: '@@',
      baseTextHash: 'hash',
    })

    expect(rpc).toHaveBeenCalledWith('create_talk_procedure_proposal', {
      p_conversation_id: 'conversation-1',
      p_summary: 'Swap',
      p_proposed_text: 'edited',
      p_diff: '@@',
      p_base_text_hash: 'hash',
    })
    expect(created).toEqual({ proposalId: 'p-1', baseRevisionNumber: 4 })
  })

  it('carries the SQLSTATE of a failed RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'stale', code: '40001' } })

    const failure = await createProcedureProposal({ rpc } as never, { conversationId: 'c', summary: 's', proposedText: 't', diff: 'd', baseTextHash: 'h' }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(TalkActionError)
    expect(failure).toMatchObject({ sqlState: '40001' })
  })

  it('distinguishes an applied proposal from a stale one and never invents text', async () => {
    const applied = vi.fn().mockResolvedValue({ data: [{ outcome: 'applied', proposal_id: 'p-1', summary: 'Swap', proposed_text: 'edited', base_revision_number: 4 }], error: null })
    const stale = vi.fn().mockResolvedValue({ data: [{ outcome: 'stale', proposal_id: 'p-1', summary: 'Swap', proposed_text: null, base_revision_number: 4 }], error: null })
    const malformed = vi.fn().mockResolvedValue({ data: [{ outcome: 'applied', proposal_id: 'p-1' }], error: null })

    expect(await applyProcedureProposal({ rpc: applied } as never, input)).toEqual({ outcome: 'applied', proposalId: 'p-1', summary: 'Swap', proposedText: 'edited' })
    expect(await applyProcedureProposal({ rpc: stale } as never, input)).toEqual({ outcome: 'stale' })
    await expect(applyProcedureProposal({ rpc: malformed } as never, input)).rejects.toThrow('invalid receipt')
    expect(applied).toHaveBeenCalledWith('apply_talk_procedure_proposal', { p_conversation_id: 'conversation-1', p_proposal_id: 'proposal-1' })
  })

  it('cancels through its own RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'cancelled', error: null })

    await cancelProcedureProposal({ rpc } as never, input)

    expect(rpc).toHaveBeenCalledWith('cancel_talk_procedure_proposal', { p_conversation_id: 'conversation-1', p_proposal_id: 'proposal-1' })
  })
})
