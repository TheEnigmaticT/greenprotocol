import type { SupabaseClient } from '@supabase/supabase-js'

export interface ScopedRecommendationApprovalReceipt {
  actionId: string
  recommendationId: string
  label: string
  alreadyAccepted: boolean
  revisionNumber: number
}

interface ApprovalRpcReceipt {
  action_id: string
  recommendation_id: string
  label: string
  already_accepted: boolean
  revision_number: number
}

const APPROVAL_REQUESTS: Record<string, true> = {
  'approve this': true,
  'accept this recommendation': true,
}

export function isExplicitScopedApprovalRequest(content: string): boolean {
  const normalized = content.trim().toLowerCase().replace(/[.!]+$/, '')
  return APPROVAL_REQUESTS[normalized] === true
}

export async function approveScopedRecommendation(input: {
  supabase: SupabaseClient
  conversationId: string
}): Promise<ScopedRecommendationApprovalReceipt> {
  const { data, error } = await input.supabase.rpc('approve_scoped_recommendation', {
    p_conversation_id: input.conversationId,
  })

  if (error) {
    throw new Error(error.message)
  }

  const receipt = Array.isArray(data) ? data[0] : data
  if (!receipt || typeof receipt !== 'object') {
    throw new Error('Approval did not return a receipt')
  }

  const result = receipt as ApprovalRpcReceipt
  if (
    typeof result.action_id !== 'string'
    || typeof result.recommendation_id !== 'string'
    || typeof result.label !== 'string'
    || typeof result.already_accepted !== 'boolean'
    || typeof result.revision_number !== 'number'
  ) {
    throw new Error('Approval returned an invalid receipt')
  }

  return {
    actionId: result.action_id,
    recommendationId: result.recommendation_id,
    label: result.label,
    alreadyAccepted: result.already_accepted,
    revisionNumber: result.revision_number,
  }
}
