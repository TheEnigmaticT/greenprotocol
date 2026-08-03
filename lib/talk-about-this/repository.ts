import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnalysisResult } from '@/lib/types'
import type { TalkAboutContext, TalkAboutScope } from '@/lib/talk-about-this/context'

export interface StoredAnalysis {
  id: string
  protocol_text: string
  analysis_result: AnalysisResult
}

export interface TalkConversation {
  id: string
  analysis_id: string
  scope: TalkAboutScope
  context_snapshot: TalkAboutContext
  context_hash: string
  status: 'active' | 'closed'
}

export interface TalkMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: string[]
  status: 'streaming' | 'complete' | 'failed' | 'cancelled'
  ttft_ms: number | null
  created_at: string
}

export async function loadOwnedAnalysis(
  supabase: SupabaseClient,
  userId: string,
  analysisId: string,
): Promise<StoredAnalysis | null> {
  const { data, error } = await supabase
    .from('gpc_analyses')
    .select('id, protocol_text, analysis_result')
    .eq('id', analysisId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load analysis: ${error.message}`)
  }

  return data as StoredAnalysis | null
}

export async function createConversation(
  supabase: SupabaseClient,
  userId: string,
  analysisId: string,
  scope: TalkAboutScope,
  context: TalkAboutContext,
): Promise<TalkConversation> {
  const { data, error } = await supabase
    .from('gpc_talk_conversations')
    .insert({
      analysis_id: analysisId,
      user_id: userId,
      scope,
      context_snapshot: context,
      context_hash: context.contextHash,
    })
    .select('id, analysis_id, scope, context_snapshot, context_hash, status')
    .single()

  if (error || !data) {
    throw new Error(error?.message || 'Failed to create conversation')
  }

  return data as TalkConversation
}

export async function loadOwnedConversation(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<TalkConversation | null> {
  const { data, error } = await supabase
    .from('gpc_talk_conversations')
    .select('id, analysis_id, scope, context_snapshot, context_hash, status')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load conversation: ${error.message}`)
  }

  return data as TalkConversation | null
}

export async function createMessage(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  message: Omit<TalkMessage, 'id' | 'created_at'>,
): Promise<TalkMessage> {
  const { data, error } = await supabase
    .from('gpc_talk_messages')
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      ...message,
    })
    .select('id, role, content, citations, status, ttft_ms, created_at')
    .single()

  if (error || !data) {
    throw new Error(error?.message || 'Failed to create message')
  }

  return data as TalkMessage
}

export async function listConversationMessages(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<TalkMessage[]> {
  const { data, error } = await supabase
    .from('gpc_talk_messages')
    .select('id, role, content, citations, status, ttft_ms, created_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(`Failed to load conversation messages: ${error.message}`)
  }

  return (data ?? []) as TalkMessage[]
}
