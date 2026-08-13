import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnalysisResult, Citation, LiteratureEvidenceMatch } from '@/lib/types'
import type { TalkAboutContext, TalkAboutScope } from '@/lib/talk-about-this/context'
import type { AdminSupabaseClient } from '@/lib/supabase/admin'

export interface StoredAnalysis {
  id: string
  protocol_text: string
  analysis_result: AnalysisResult
  revision_number: number
}

export interface TalkConversation {
  id: string
  analysis_id: string
  scope: TalkAboutScope
  context_snapshot: TalkAboutContext
  context_hash: string
  status: 'active' | 'closed'
}

export interface StoredRecommendationApprovalAction {
  id: string
  target_recommendation_id: string
  label: string
  already_applied: boolean
  revision_number: number
  completed_at: string | null
}

export interface PersistedRecommendationApprovalReceipt {
  actionId: string
  recommendationId: string
  label: string
  alreadyAccepted: boolean
  revisionNumber: number
  receivedAt: string
}

export function receiptFromStoredAction(
  action: StoredRecommendationApprovalAction | null,
): PersistedRecommendationApprovalReceipt | null {
  if (
    !action
    || typeof action.id !== 'string'
    || !action.id.trim()
    || typeof action.target_recommendation_id !== 'string'
    || !action.target_recommendation_id.trim()
    || typeof action.label !== 'string'
    || !action.label.trim()
    || typeof action.already_applied !== 'boolean'
    || !Number.isSafeInteger(action.revision_number)
    || action.revision_number < 1
    || typeof action.completed_at !== 'string'
    || !action.completed_at.trim()
  ) return null

  return {
    actionId: action.id,
    recommendationId: action.target_recommendation_id,
    label: action.label,
    alreadyAccepted: action.already_applied,
    revisionNumber: action.revision_number,
    receivedAt: action.completed_at,
  }
}

export interface StoredLiteratureCitation extends Citation {
  evidence: Pick<LiteratureEvidenceMatch,
    | 'id'
    | 'sourceDocumentId'
    | 'doi'
    | 'title'
    | 'pageStart'
    | 'pageEnd'
    | 'quote'
    | 'applicability'
    | 'limitations'
    | 'candidateStatus'
  >
}

export type StoredMessageCitation = string | StoredLiteratureCitation | StoredMessageTelemetry

export interface RetrievalAttemptTelemetry {
  callId: string
  status: 'complete' | 'failed' | 'aborted'
  embeddingStartedAt?: number
  embeddingFinishedAt?: number
  rpcStartedAt?: number
  rpcFinishedAt?: number
}

export interface StoredMessageTelemetry {
  telemetry: {
    clock: 'performance.now'
    routeStartedAt: number
    initialProviderFirstTextAt?: number
    finalProviderFirstTextAt?: number
    retrievalAttempts?: RetrievalAttemptTelemetry[]
  }
}


export interface TalkMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: StoredMessageCitation[]
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
    .select('id, protocol_text, analysis_result, revision_number')
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

export async function findOwnedConversationByContextHash(
  supabase: SupabaseClient,
  userId: string,
  analysisId: string,
  contextHash: string,
): Promise<TalkConversation | null> {
  const { data, error } = await supabase
    .from('gpc_talk_conversations')
    .select('id, analysis_id, scope, context_snapshot, context_hash, status')
    .eq('analysis_id', analysisId)
    .order('created_at', { ascending: false })
    .limit(1)
    .eq('user_id', userId)
    .eq('context_hash', contextHash)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to find conversation: ${error.message}`)
  }

  return data as TalkConversation | null
}

export async function loadOwnedRecommendationApprovalReceipt(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<PersistedRecommendationApprovalReceipt | null> {
  const { data, error } = await supabase
    .from('gpc_talk_actions')
    .select('id, target_recommendation_id, label, already_applied, revision_number, completed_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .eq('action_type', 'approve_recommendation')
    .eq('status', 'completed')
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load approval receipt: ${error.message}`)
  }

  return receiptFromStoredAction(data as StoredRecommendationApprovalAction | null)
}

export function assistantMessageCitations(
  snapshotCitationIds: string[],
  literatureCitations: Citation[],
  literatureEvidence: LiteratureEvidenceMatch[],
  telemetry?: StoredMessageTelemetry['telemetry'],
): StoredMessageCitation[] {
  const evidenceById = new Map(literatureEvidence.map(evidence => [evidence.id, evidence]))
  const citations: StoredMessageCitation[] = [...snapshotCitationIds]

  for (const citation of literatureCitations) {
    const evidence = evidenceById.get(citation.source_id)
    if (!evidence || citations.some(item => (
      typeof item === 'string'
        ? item === citation.source_id
        : 'source_id' in item && item.source_id === citation.source_id
    ))) continue

    citations.push({
      ...citation,
      evidence: {
        id: evidence.id,
        sourceDocumentId: evidence.sourceDocumentId,
        doi: evidence.doi,
        title: evidence.title,
        pageStart: evidence.pageStart,
        pageEnd: evidence.pageEnd,
        quote: evidence.quote,
        applicability: evidence.applicability,
        limitations: evidence.limitations,
        candidateStatus: evidence.candidateStatus,
      },
    })
  }
  if (telemetry) citations.push({ telemetry })
  return citations
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

export type ToolRunStatus = 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'skipped_limit'

export type ToolRunReasonCode =
  | 'none'
  | 'deadline_exceeded'
  | 'client_cancelled'
  | 'call_limit_exceeded'
  | 'invalid_request'
  | 'tool_error'
  | 'diagnostic_write_failed'

export interface CreateToolRunInput {
  conversationId: string
  userMessageId: string
  turnId: string
  providerRound: number
  callId: string
  toolName: string
  validatedArguments: Record<string, unknown>
  status: ToolRunStatus
  reasonCode: ToolRunReasonCode
  reasonDetail?: string
  dispatchBudgetMs?: number
  startedAt?: string
  completedAt?: string
  elapsedMs?: number
  telemetry: Record<string, unknown>
}

export interface LinkToolRunsToAssistantMessageInput {
  conversationId: string
  turnId: string
  assistantMessageId: string
}

interface StoredToolRun {
  id: string
  conversation_id: string
  analysis_id: string
  user_id: string
  user_message_id: string | null
  assistant_message_id: string | null
  turn_id: string
  provider_round: number
  call_id: string
  tool_name: string
  validated_arguments: Record<string, unknown>
  status: ToolRunStatus
  reason_code: ToolRunReasonCode
  reason_detail: string | null
  dispatch_budget_ms: number | null
  started_at: string | null
  completed_at: string | null
  elapsed_ms: number | null
  telemetry: Record<string, unknown>
  created_at: string
}

export interface PersistedToolRun {
  id: string
  conversationId: string
  analysisId: string
  userId: string
  userMessageId: string | null
  assistantMessageId: string | null
  turnId: string
  providerRound: number
  callId: string
  toolName: string
  validatedArguments: Record<string, unknown>
  status: ToolRunStatus
  reasonCode: ToolRunReasonCode
  reasonDetail: string | null
  dispatchBudgetMs: number | null
  startedAt: string | null
  completedAt: string | null
  elapsedMs: number | null
  telemetry: Record<string, unknown>
  createdAt: string
}

const toolRunStatuses: Record<ToolRunStatus, true> = {
  completed: true,
  failed: true,
  timed_out: true,
  cancelled: true,
  skipped_limit: true,
}

const toolRunReasonCodes: Record<ToolRunReasonCode, true> = {
  none: true,
  deadline_exceeded: true,
  client_cancelled: true,
  call_limit_exceeded: true,
  invalid_request: true,
  tool_error: true,
  diagnostic_write_failed: true,
}

const safeReasonDetails: Record<Exclude<ToolRunReasonCode, 'none'>, string> = {
  deadline_exceeded: 'The tool did not finish before its dispatch deadline.',
  client_cancelled: 'The client cancelled the tool request.',
  call_limit_exceeded: 'The tool call limit was reached.',
  invalid_request: 'The tool request was invalid.',
  tool_error: 'The tool could not complete the request.',
  diagnostic_write_failed: 'Tool diagnostic persistence failed.',
}

const validatedArgumentKeys: Record<string, 'string' | 'number' | 'string_array'> = {
  chemical: 'string',
  mode: 'string',
  solvent: 'string',
  solute: 'string',
  coSolvent: 'string',
  fractionSolvent: 'number',
  fractionType: 'string',
  temperatureK: 'number',
  currentSolvent: 'string',
  signalGroups: 'string_array',
}

const telemetryKeys: Record<string, 'number'> = {
  elapsedMs: 'number',
  queueMs: 'number',
  executionMs: 'number',
  attempt: 'number',
  providerRound: 'number',
}

const toolRunArgumentSchemas: Record<string, Record<string, 'string' | 'number' | 'string_array'>> = {
  lookup_chem21_solvent: { chemical: 'string' },
  lookup_pubchem_profile: { chemical: 'string' },
  calculate_rdkit_properties: { chemical: 'string' },
  lookup_experimental_solvent_evidence: {
    mode: 'string',
    solvent: 'string',
    solute: 'string',
    coSolvent: 'string',
    fractionSolvent: 'number',
    fractionType: 'string',
    temperatureK: 'number',
  },
  lookup_solvent_hazard_profile: { solvent: 'string' },
  screen_solvent_candidates: {
    solute: 'string',
    currentSolvent: 'string',
    temperatureK: 'number',
  },
  search_scoped_literature_evidence: { signalGroups: 'string_array' },
}

const sensitiveDiagnosticValue = /(?:\b(?:api[_ -]?key|authorization|bearer|token|secret|password|credential|error|exception)\b|(?:sk|pk)_[A-Za-z0-9_-]{8,})/i

function redactDiagnosticRecord(
  value: Record<string, unknown>,
  allowedKeys: Record<string, 'string' | 'number' | 'string_array'>,
): Record<string, string | number | string[]> {
  const redacted: Record<string, string | number | string[]> = {}

  for (const [key, candidate] of Object.entries(value)) {
    const expectedType = allowedKeys[key]
    if (
      expectedType === 'string'
      && typeof candidate === 'string'
      && candidate.length > 0
      && candidate.length <= 100
      && !sensitiveDiagnosticValue.test(candidate)
    ) {
      redacted[key] = candidate
    } else if (expectedType === 'number' && typeof candidate === 'number' && Number.isFinite(candidate)) {
      redacted[key] = candidate
    } else if (
      expectedType === 'string_array'
      && Array.isArray(candidate)
      && candidate.length <= 20
      && candidate.every(item => (
        typeof item === 'string'
        && item.length <= 100
        && !sensitiveDiagnosticValue.test(item)
      ))
    ) {
      redacted[key] = candidate
    }
  }

  return redacted
}

function isBoundedNonEmptyString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximumLength
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isBoundedRecord(value: unknown): value is Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false

  try {
    return JSON.stringify(value).length <= 16_384
  } catch {
    return false
  }
}

function isOptionalIsoTimestamp(value: unknown): value is string | undefined {
  return value === undefined || (
    typeof value === 'string'
    && value.length <= 64
    && !Number.isNaN(Date.parse(value))
  )
}

function invalidToolRunInput(input: CreateToolRunInput, userId: string): boolean {
  return !isBoundedNonEmptyString(userId, 200)
    || !isBoundedNonEmptyString(input.conversationId, 200)
    || !isBoundedNonEmptyString(input.userMessageId, 200)
    || !isBoundedNonEmptyString(input.turnId, 200)
    || !isFiniteNonNegativeInteger(input.providerRound)
    || !isBoundedNonEmptyString(input.callId, 200)
    || !isBoundedNonEmptyString(input.toolName, 100)
    || !isBoundedRecord(input.validatedArguments)
    || !toolRunStatuses[input.status]
    || !toolRunReasonCodes[input.reasonCode]
    || (input.reasonDetail !== undefined && typeof input.reasonDetail !== 'string')
    || (input.dispatchBudgetMs !== undefined && !isFiniteNonNegativeInteger(input.dispatchBudgetMs))
    || !isOptionalIsoTimestamp(input.startedAt)
    || !isOptionalIsoTimestamp(input.completedAt)
    || (input.elapsedMs !== undefined && !isFiniteNonNegativeInteger(input.elapsedMs))
    || !isBoundedRecord(input.telemetry)
}

function persistedToolRunFromStored(row: StoredToolRun): PersistedToolRun {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    analysisId: row.analysis_id,
    userId: row.user_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    turnId: row.turn_id,
    providerRound: row.provider_round,
    callId: row.call_id,
    toolName: row.tool_name,
    validatedArguments: row.validated_arguments,
    status: row.status,
    reasonCode: row.reason_code,
    reasonDetail: row.reason_detail,
    dispatchBudgetMs: row.dispatch_budget_ms,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    elapsedMs: row.elapsed_ms,
    telemetry: row.telemetry,
    createdAt: row.created_at,
  }
}

export async function createToolRun(
  supabase: AdminSupabaseClient,
  userId: string,
  input: CreateToolRunInput,
): Promise<PersistedToolRun> {
  if (invalidToolRunInput(input, userId)) {
    throw new Error('Invalid tool-run diagnostic input')
  }

  const { data, error } = await supabase.rpc('record_scoped_tool_run' as never, {
    p_user_id: userId,
    p_conversation_id: input.conversationId,
    p_user_message_id: input.userMessageId,
    p_turn_id: input.turnId,
    p_provider_round: input.providerRound,
    p_call_id: input.callId,
    p_tool_name: input.toolName,
    p_validated_arguments: redactDiagnosticRecord(
      input.validatedArguments,
      toolRunArgumentSchemas[input.toolName] ?? {},
    ),
    p_status: input.status,
    p_reason_code: input.reasonCode,
    p_reason_detail: input.reasonDetail === undefined || input.reasonCode === 'none'
      ? null
      : safeReasonDetails[input.reasonCode],
    p_dispatch_budget_ms: input.dispatchBudgetMs ?? null,
    p_started_at: input.startedAt ?? null,
    p_completed_at: input.completedAt ?? null,
    p_elapsed_ms: input.elapsedMs ?? null,
    p_telemetry: redactDiagnosticRecord(input.telemetry, telemetryKeys),
  } as never)

  if (error || !Array.isArray(data) || data.length !== 1) {
    throw new Error('Unable to persist tool-run diagnostic')
  }

  return persistedToolRunFromStored(data[0] as StoredToolRun)
}

export async function linkToolRunsToAssistantMessage(
  supabase: AdminSupabaseClient,
  userId: string,
  input: LinkToolRunsToAssistantMessageInput,
): Promise<number> {
  if (
    !isBoundedNonEmptyString(userId, 200)
    || !isBoundedNonEmptyString(input.conversationId, 200)
    || !isBoundedNonEmptyString(input.turnId, 200)
    || !isBoundedNonEmptyString(input.assistantMessageId, 200)
  ) {
    throw new Error('Invalid tool-run diagnostic input')
  }

  const { data, error } = await supabase.rpc('link_scoped_tool_runs_to_assistant_message' as never, {
    p_user_id: userId,
    p_conversation_id: input.conversationId,
    p_turn_id: input.turnId,
    p_assistant_message_id: input.assistantMessageId,
  } as never)

  if (error || !Number.isSafeInteger(data) || data < 0) {
    throw new Error('Unable to persist tool-run diagnostic')
  }

  return data
}
