import { runScopedToolChat } from '@/lib/talk-about-this/agent'
import { firstForwardedDeltaMs } from '@/lib/talk-about-this/latency'
import { createConfiguredChatProvider, type ChatMessage } from '@/lib/talk-about-this/chat-provider'
import { executeScopedTool } from '@/lib/talk-about-this/tools'
import {
  assistantMessageCitations,
  createMessage,
  createToolRun,
  linkToolRunsToAssistantMessage,
  listConversationMessages,
  loadOwnedConversation,
  type RetrievalAttemptTelemetry,
  type StoredMessageTelemetry,
} from '@/lib/talk-about-this/repository'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { approveScopedRecommendation, isExplicitScopedApprovalRequest } from '@/lib/talk-about-this/actions'
import type { Citation, LiteratureEvidenceMatch } from '@/lib/types'

export const runtime = 'nodejs'

const MAX_RETRIEVAL_ATTEMPTS = 5
const TERMINAL_DIAGNOSTIC_SETTLEMENT_MS = 250

async function awaitDiagnosticPersistence(
  diagnosticPersistence: Promise<void>,
  identifiers: { conversationId: string, turnId: string },
): Promise<void> {
  const timeout = Promise.withResolvers<void>()
  const timeoutId = setTimeout(timeout.resolve, TERMINAL_DIAGNOSTIC_SETTLEMENT_MS)
  try {
    const timedOut = await Promise.race([
      diagnosticPersistence.then(() => false, () => false),
      timeout.promise.then(() => true),
    ])
    if (timedOut) {
      console.error('Scoped chat tool diagnostic settlement timed out', identifiers)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}


function stageTelemetry(value: unknown): Omit<RetrievalAttemptTelemetry, 'callId' | 'status'> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const telemetry: Omit<RetrievalAttemptTelemetry, 'callId' | 'status'> = {}
  let previousTimestamp: number | undefined
  for (const key of ['embeddingStartedAt', 'embeddingFinishedAt', 'rpcStartedAt', 'rpcFinishedAt'] as const) {
    const timestamp = (value as Record<string, unknown>)[key]
    if (timestamp === undefined) continue
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) return undefined
    if (previousTimestamp !== undefined && timestamp < previousTimestamp) return undefined
    telemetry[key] = timestamp
    previousTimestamp = timestamp
  }
  return Object.keys(telemetry).length ? telemetry : undefined
}

function retrievalAttempt(data: Record<string, unknown>): RetrievalAttemptTelemetry | undefined {
  if (data.tool !== 'search_scoped_literature_evidence' || typeof data.callId !== 'string') return undefined
  const timing = stageTelemetry(data.telemetry)
  if (!timing) return undefined
  const warnings = Array.isArray(data.warnings) ? data.warnings : []
  const status = warnings.includes('Literature evidence retrieval aborted')
    ? 'aborted'
    : data.status === 'ok' ? 'complete' : 'failed'
  return { callId: data.callId, status, ...timing }
}

export function mergeActivityTelemetry(
  current: StoredMessageTelemetry['telemetry'],
  data: Record<string, unknown>,
): StoredMessageTelemetry['telemetry'] {
  const attempt = retrievalAttempt(data)
  if (!attempt) return current
  return {
    ...current,
    retrievalAttempts: [...(current.retrievalAttempts ?? []), attempt].slice(-MAX_RETRIEVAL_ATTEMPTS),
  }
}
function schedulingTelemetry(value: unknown): StoredMessageTelemetry['telemetry']['scheduling'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const scheduling = value as Record<string, unknown>
  const values = ['requestedCount', 'dispatchedCount', 'deduplicatedCount'].map(key => scheduling[key])
  if (!values.every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return undefined
  const [requestedCount, dispatchedCount, deduplicatedCount] = values as number[]
  if (dispatchedCount > requestedCount || deduplicatedCount > requestedCount) return undefined
  return { requestedCount, dispatchedCount, deduplicatedCount }
}

function mergeTerminalTelemetry(
  current: StoredMessageTelemetry['telemetry'],
  value: { scheduling?: unknown },
): StoredMessageTelemetry['telemetry'] {
  const scheduling = schedulingTelemetry(value.scheduling)
  const { scheduling: _scheduling, ...safeTelemetry } = value
  return {
    ...current,
    ...safeTelemetry,
    ...(scheduling ? { scheduling } : {}),
  }
}


export function activityPayload(data: Record<string, unknown>): Record<string, unknown> {
  const failure = data.status === 'failed'
    || data.status === 'timed_out'
    || data.status === 'cancelled'
    || data.status === 'skipped_limit'
  const base = {
    callId: typeof data.callId === 'string' ? data.callId : undefined,
    tool: typeof data.tool === 'string' ? data.tool : undefined,
    status: typeof data.status === 'string' ? data.status : undefined,
    source: typeof data.source === 'string' ? data.source : undefined,
  }
  if (failure) {
    return {
      ...base,
      reasonCode: typeof data.reasonCode === 'string' ? data.reasonCode : undefined,
      userNote: typeof data.userNote === 'string' ? data.userNote : undefined,
    }
  }
  return {
    ...base,
    classification: typeof data.classification === 'string' ? data.classification : undefined,
    measurementCount: typeof data.measurementCount === 'number' ? data.measurementCount : undefined,
    datasetSources: Array.isArray(data.datasetSources)
      ? data.datasetSources.filter((source): source is string => typeof source === 'string')
      : undefined,
    warnings: Array.isArray(data.warnings)
      ? data.warnings.filter((warning): warning is string => typeof warning === 'string')
      : undefined,
    citations: Array.isArray(data.citations)
      ? data.citations.filter((citation): citation is Citation => citation !== null && typeof citation === 'object'
        && typeof (citation as Citation).source_id === 'string').slice(0, 5)
      : undefined,
    evidence: Array.isArray(data.evidence)
      ? data.evidence.filter((evidence): evidence is LiteratureEvidenceMatch => evidence !== null && typeof evidence === 'object'
        && typeof (evidence as LiteratureEvidenceMatch).id === 'string').slice(0, 5)
      : undefined,
    telemetry: stageTelemetry(data.telemetry),
  }
}


export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { conversationId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let content: string
  try {
    const body = await request.json() as { content?: unknown }
    if (typeof body.content !== 'string' || !body.content.trim()) {
      return Response.json({ error: 'Message content is required' }, { status: 400 })
    }
    content = body.content.trim()
    if (content.length > 4_000) {
      return Response.json({ error: 'Message content must be 4,000 characters or fewer' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const conversation = await loadOwnedConversation(supabase, user.id, conversationId)
  if (!conversation) {
    return Response.json({ error: 'Conversation not found' }, { status: 404 })
  }
  if (conversation.status !== 'active') {
    return Response.json({ error: 'Conversation is closed' }, { status: 409 })
  }


  if (isExplicitScopedApprovalRequest(content)) {
    try {
      const receipt = await approveScopedRecommendation({ supabase, conversationId })
      await createMessage(supabase, user.id, conversationId, {
        role: 'user',
        content,
        citations: [],
        status: 'complete',
        ttft_ms: null,
      })
      await createMessage(supabase, user.id, conversationId, {
        role: 'assistant',
        content: receipt.alreadyAccepted
          ? `${receipt.label} was already approved from this scoped conversation.`
          : `${receipt.label} has been approved from this scoped conversation.`,
        citations: [],
        status: 'complete',
        ttft_ms: null,
      })

      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          const send = (event: string, data: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
          }
          send('conversation', { conversationId })
          send('recommendation-approved', {
            recommendationId: receipt.recommendationId,
            label: receipt.label,
            alreadyAccepted: receipt.alreadyAccepted,
            actionId: receipt.actionId,
            revisionNumber: receipt.revisionNumber,
          })
          send('done', {
            status: 'complete',
            ttftMs: null,
            citationIds: [],
            action: 'approve_recommendation',
          })
          controller.close()
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : 'Unable to approve this recommendation',
      }, { status: 409 })
    }
  }
  let provider
  try {
    provider = createConfiguredChatProvider()
  } catch {
    return Response.json({ error: 'Open-model chat is not configured' }, { status: 503 })
  }

  const previousMessages = await listConversationMessages(supabase, user.id, conversationId)
  const userMessage = await createMessage(supabase, user.id, conversationId, {
    role: 'user',
    content,
    citations: [],
    status: 'complete',
    ttft_ms: null,
  })
  const turnId = crypto.randomUUID()

  const encoder = new TextEncoder()
  const abortController = new AbortController()
  request.signal.addEventListener('abort', () => abortController.abort(), { once: true })
  const startedAt = Date.now()

  const stream = new ReadableStream({
    start(controller) {
      void (async () => {
        let answer = ''
        let ttftMs: number | null = null
        let status: 'complete' | 'failed' | 'cancelled' = 'complete'
        let literatureCitations: Citation[] = []
        let latencyTelemetry: StoredMessageTelemetry['telemetry'] = {
          clock: 'performance.now',
          routeStartedAt: performance.now(),
        }
        let literatureEvidence: LiteratureEvidenceMatch[] = []

        const send = (event: string, data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        }
        let diagnosticPersistence = Promise.resolve()

        try {
          send('conversation', { conversationId })
          const messages: ChatMessage[] = [
            ...previousMessages
              .slice(-12)
              .map(message => ({ role: message.role, content: message.content }) as ChatMessage),
            { role: 'user', content },
          ]
          const result = await runScopedToolChat({
            provider,
            context: conversation.context_snapshot,
            messages,
            signal: abortController.signal,
            executeTool: (call, signal) => executeScopedTool(conversation.context_snapshot, call, signal),
            onToolRun: async input => {
              try {
                await createToolRun(createAdminClient(), user.id, {
                  ...input,
                  conversationId,
                  userMessageId: userMessage.id,
                })
              } catch {
                console.error('Scoped chat tool diagnostic persistence failed', {
                  conversationId,
                  turnId,
                  callId: input.callId,
                  toolName: input.toolName,
                })
              }
            },
            turnId,
            onEvent: (event, data) => {
              ttftMs = firstForwardedDeltaMs(ttftMs, event, startedAt, Date.now())
              const activity = event === 'tool-complete' || event === 'tool-failed' ? activityPayload(data) : data
              if (event === 'tool-complete') latencyTelemetry = mergeActivityTelemetry(latencyTelemetry, activity)
              send(event, activity)
            },
          })
          answer = result.answer
          literatureCitations = result.citations
          latencyTelemetry = mergeTerminalTelemetry(latencyTelemetry, result.telemetry)
          literatureEvidence = result.evidence
          diagnosticPersistence = result.diagnosticPersistence ?? Promise.resolve()
        } catch (error) {
          status = abortController.signal.aborted ? 'cancelled' : 'failed'
          console.error('Chat response failed', error)
          send('error', {
            error: status === 'cancelled' ? 'Response cancelled' : 'Chat response failed',
          })
        } finally {
          const snapshotCitationIds = conversation.context_snapshot.citations
            .filter(citation => answer.includes(`[${citation.id}]`))
            .map(citation => citation.id)
          const citationIds = [...new Set([
            ...snapshotCitationIds,
            ...literatureCitations.map(citation => citation.source_id),
          ])]
          const citations = assistantMessageCitations(
            snapshotCitationIds,
            literatureCitations,
            literatureEvidence,
            latencyTelemetry,
          )

          try {
            const assistantMessage = await createMessage(supabase, user.id, conversationId, {
              role: 'assistant',
              content: answer || (status === 'cancelled' ? 'Response cancelled.' : 'Unable to generate a response.'),
              citations,
              status,
              ttft_ms: ttftMs,
            })
            await awaitDiagnosticPersistence(diagnosticPersistence, { conversationId, turnId })
            try {
              await linkToolRunsToAssistantMessage(createAdminClient(), user.id, {
                conversationId,
                turnId,
                assistantMessageId: assistantMessage.id,
              })
            } catch {
              console.error('Scoped chat tool diagnostic linking failed', {
                conversationId,
                turnId,
                assistantMessageId: assistantMessage.id,
              })
            }
          } catch {
            status = 'failed'
            console.error('Scoped chat assistant message persistence failed', {
              conversationId,
              turnId,
              event: 'assistant_message_persistence_failed',
            })
            send('error', { error: 'Chat response could not be saved.' })
          } finally {
            send('done', {
              status,
              ttftMs,
              citationIds,
              evidence: literatureEvidence,
              telemetry: latencyTelemetry,
            })
            controller.close()
          }
        }
      })()
    },
    cancel() {
      abortController.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
