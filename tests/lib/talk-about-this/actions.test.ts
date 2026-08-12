import { describe, expect, it, vi } from 'vitest'
import {
  approveScopedRecommendation,
  isExplicitScopedApprovalRequest,
} from '@/lib/talk-about-this/actions'

describe('isExplicitScopedApprovalRequest', () => {
  it.each(['approve this', 'Accept this recommendation.'])('recognizes direct approval %j', text => {
    expect(isExplicitScopedApprovalRequest(text)).toBe(true)
  })

  it.each([
    'should I approve this?',
    'do not approve this',
    'approve this if it is safe',
    'approve this and reject the next',
  ])('rejects non-authorizing text %j', text => {
    expect(isExplicitScopedApprovalRequest(text)).toBe(false)
  })
})

describe('approveScopedRecommendation', () => {
  it('calls one RPC with conversation ID only', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        action_id: 'action-1',
        recommendation_id: 'recommendation-1',
        label: 'Use ethanol',
        already_accepted: false,
        revision_number: 2,
      }],
      error: null,
    })
    const supabase = { rpc }

    await approveScopedRecommendation({ supabase: supabase as never, conversationId: 'conversation-1' })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('approve_scoped_recommendation', { p_conversation_id: 'conversation-1' })
  })

  it('returns the receipt supplied by the atomic RPC', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: [{
          action_id: 'action-1',
          recommendation_id: 'recommendation-1',
          label: 'Use ethanol',
          already_accepted: true,
          revision_number: 2,
        }],
        error: null,
      }),
    }

    await expect(approveScopedRecommendation({ supabase: supabase as never, conversationId: 'conversation-1' })).resolves.toEqual({
      actionId: 'action-1',
      recommendationId: 'recommendation-1',
      label: 'Use ethanol',
      alreadyAccepted: true,
      revisionNumber: 2,
    })
  })

  it('fails closed when the atomic RPC rejects the conversation', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'Scoped recommendation target is stale' } }),
    }

    await expect(approveScopedRecommendation({ supabase: supabase as never, conversationId: 'conversation-1' })).rejects.toThrow('Scoped recommendation target is stale')
  })
})
