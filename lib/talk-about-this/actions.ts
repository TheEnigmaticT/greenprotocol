import type { SupabaseClient } from '@supabase/supabase-js'
import { TalkActionError } from '@/lib/talk-about-this/action-errors'
import type { RecommendationDecisionReceipt } from '@/lib/talk-about-this/decisions'

export type RecommendationDecision = RecommendationDecisionReceipt['decision']

interface DecisionRpcReceipt {
  action_id: string
  recommendation_id: string
  label: string
  already_accepted: boolean
  revision_number: number
}

/**
 * Exact phrases only. The model is never consulted for these, so a decision can
 * never be argued into (or out of) existence by conversation text.
 */
const DECISION_REQUESTS: Record<string, RecommendationDecision> = {
  'approve this': 'approved',
  'accept this recommendation': 'approved',
  'accept this': 'approved',
  'approve this recommendation': 'approved',
  'reject this': 'rejected',
  'reject this recommendation': 'rejected',
  'dismiss this': 'rejected',
}

const DECISION_RPC: Record<RecommendationDecision, string> = {
  approved: 'approve_scoped_recommendation',
  rejected: 'reject_scoped_recommendation',
}

export function explicitRecommendationDecision(content: string): RecommendationDecision | null {
  const normalized = content.trim().toLowerCase().replace(/[.!]+$/, '')
  return Object.hasOwn(DECISION_REQUESTS, normalized) ? DECISION_REQUESTS[normalized] : null
}

export function isExplicitScopedApprovalRequest(content: string): boolean {
  return explicitRecommendationDecision(content) === 'approved'
}

export function isExplicitScopedRejectionRequest(content: string): boolean {
  return explicitRecommendationDecision(content) === 'rejected'
}

export async function decideScopedRecommendation(input: {
  supabase: SupabaseClient
  conversationId: string
  decision: RecommendationDecision
}): Promise<RecommendationDecisionReceipt> {
  const { data, error } = await input.supabase.rpc(DECISION_RPC[input.decision], {
    p_conversation_id: input.conversationId,
  })

  if (error) {
    throw new TalkActionError(error.message, error.code)
  }

  const receipt = Array.isArray(data) ? data[0] : data
  if (!receipt || typeof receipt !== 'object') {
    throw new TalkActionError('Decision did not return a receipt')
  }

  const result = receipt as DecisionRpcReceipt
  if (
    typeof result.action_id !== 'string'
    || typeof result.recommendation_id !== 'string'
    || typeof result.label !== 'string'
    || typeof result.already_accepted !== 'boolean'
    || typeof result.revision_number !== 'number'
  ) {
    throw new TalkActionError('Decision returned an invalid receipt')
  }

  return {
    actionId: result.action_id,
    recommendationId: result.recommendation_id,
    decision: input.decision,
    label: result.label,
    alreadyDecided: result.already_accepted,
    revisionNumber: result.revision_number,
  }
}

export function decisionMessage(receipt: Pick<RecommendationDecisionReceipt, 'decision' | 'label' | 'alreadyDecided'>): string {
  const verb = receipt.decision === 'approved' ? 'approved' : 'rejected'
  return receipt.alreadyDecided
    ? `${receipt.label} was already ${verb}. Nothing changed.`
    : `${receipt.label} has been ${verb}.`
}
