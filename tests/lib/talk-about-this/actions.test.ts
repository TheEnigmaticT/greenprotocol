import { describe, expect, it, vi } from 'vitest'
import {
  decideScopedRecommendation,
  decisionMessage,
  explicitRecommendationDecision,
  isExplicitScopedApprovalRequest,
  isExplicitScopedRejectionRequest,
} from '@/lib/talk-about-this/actions'
import { TalkActionError, talkActionFailure } from '@/lib/talk-about-this/action-errors'

describe('explicitRecommendationDecision', () => {
  it.each([
    ['approve this', 'approved'],
    ['accept this recommendation', 'approved'],
    ['accept this', 'approved'],
    ['approve this recommendation', 'approved'],
    ['reject this', 'rejected'],
    ['reject this recommendation', 'rejected'],
    ['dismiss this', 'rejected'],
    ['  Reject This!  ', 'rejected'],
    ['DISMISS THIS.', 'rejected'],
  ])('recognizes the direct phrase %j', (text, decision) => {
    expect(explicitRecommendationDecision(text)).toBe(decision)
  })

  it.each([
    'should I approve this?',
    'do not approve this',
    'approve this if it is safe',
    'approve this and reject the next',
    'accept this recommendation?',
    'do not accept this',
    'accept this, then change the solvent',
    'should I reject this?',
    'do not reject this',
    'reject this because it is slow',
    'reject this and approve that',
    'dismiss this?',
    'reject',
    'dismiss',
    'constructor',
    'toString',
    '__proto__',
  ])('treats conversational or lookalike text %j as ordinary chat, never a decision', text => {
    expect(explicitRecommendationDecision(text)).toBeNull()
  })

  it('keeps approval and rejection predicates exclusive', () => {
    expect(isExplicitScopedApprovalRequest('reject this')).toBe(false)
    expect(isExplicitScopedRejectionRequest('approve this')).toBe(false)
    expect(isExplicitScopedRejectionRequest('dismiss this')).toBe(true)
  })
})

describe('decideScopedRecommendation', () => {
  const rpcRow = {
    action_id: 'action-1',
    recommendation_id: 'recommendation-1',
    label: 'Use ethanol',
    already_accepted: false,
    revision_number: 2,
  }

  it.each([
    ['approved', 'approve_scoped_recommendation'],
    ['rejected', 'reject_scoped_recommendation'],
  ] as const)('calls only the %s RPC with the conversation ID', async (decision, rpcName) => {
    const rpc = vi.fn().mockResolvedValue({ data: [rpcRow], error: null })

    await decideScopedRecommendation({ supabase: { rpc } as never, conversationId: 'conversation-1', decision })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith(rpcName, { p_conversation_id: 'conversation-1' })
  })

  it('returns the receipt supplied by the atomic RPC with the requested decision', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: [{ ...rpcRow, already_accepted: true }], error: null }) }

    await expect(decideScopedRecommendation({
      supabase: supabase as never,
      conversationId: 'conversation-1',
      decision: 'rejected',
    })).resolves.toEqual({
      actionId: 'action-1',
      recommendationId: 'recommendation-1',
      decision: 'rejected',
      label: 'Use ethanol',
      alreadyDecided: true,
      revisionNumber: 2,
    })
  })

  it('carries the database SQLSTATE so routes can answer without parsing raw text', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'Scoped recommendation target is stale', code: 'P0002' } }),
    }

    const failure = await decideScopedRecommendation({
      supabase: supabase as never,
      conversationId: 'conversation-1',
      decision: 'approved',
    }).catch((error: unknown) => error)

    expect(talkActionFailure(failure, 'decision')).toMatchObject({ status: 409, code: 'recommendation_changed' })
  })

  it('rejects a receipt missing required fields instead of guessing', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: [{ action_id: 'action-1' }], error: null }) }

    await expect(decideScopedRecommendation({
      supabase: supabase as never,
      conversationId: 'conversation-1',
      decision: 'approved',
    })).rejects.toThrow('invalid receipt')
  })
})

describe('talkActionFailure', () => {
  it('never exposes raw database text or SQLSTATEs in user copy', () => {
    for (const kind of ['decision', 'proposal'] as const) {
      for (const sqlState of ['42501', 'P0002', '40001', '22023', '55000', '22P02', 'XX000']) {
        const error = new TalkActionError('relation "gpc_talk_actions" violates constraint', sqlState)
        const { message } = talkActionFailure(error, kind)
        expect(message).not.toMatch(/gpc_|relation|constraint|SQLSTATE|P0002|rpc/i)
      }
    }
  })

  it('falls back to a safe generic failure for unknown errors', () => {
    expect(talkActionFailure(new Error('boom'), 'proposal')).toMatchObject({ status: 500 })
    expect(talkActionFailure('x', 'decision')).toMatchObject({ status: 500 })
  })

  it('treats a malformed proposal id as not found', () => {
    expect(talkActionFailure(new TalkActionError('x', '22P02'), 'proposal')).toMatchObject({ status: 404 })
  })
})

describe('decisionMessage', () => {
  it('states what happened without implying a repeat changed anything', () => {
    expect(decisionMessage({ decision: 'rejected', label: 'Use ethanol', alreadyDecided: false })).toBe('Use ethanol has been rejected.')
    expect(decisionMessage({ decision: 'approved', label: 'Use ethanol', alreadyDecided: true })).toBe('Use ethanol was already approved. Nothing changed.')
  })
})
