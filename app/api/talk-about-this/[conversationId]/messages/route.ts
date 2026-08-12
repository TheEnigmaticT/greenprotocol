import { runScopedToolChat } from '@/lib/talk-about-this/agent'
import { createConfiguredChatProvider, type ChatMessage } from '@/lib/talk-about-this/chat-provider'
import { executeScopedTool } from '@/lib/talk-about-this/tools'
import { createMessage, listConversationMessages, loadOwnedConversation } from '@/lib/talk-about-this/repository'
import { createClient } from '@/lib/supabase/server'
import type { Citation, LiteratureEvidenceMatch } from '@/lib/types'

export const runtime = 'nodejs'

function activityPayload(data: Record<string, unknown>): Record<string, unknown> {
  return {
    callId: typeof data.callId === 'string' ? data.callId : undefined,
    tool: typeof data.tool === 'string' ? data.tool : undefined,
    status: typeof data.status === 'string' ? data.status : undefined,
    source: typeof data.source === 'string' ? data.source : undefined,
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

  let provider
  try {
    provider = createConfiguredChatProvider()
  } catch {
    return Response.json({ error: 'Open-model chat is not configured' }, { status: 503 })
  }

  const previousMessages = await listConversationMessages(supabase, user.id, conversationId)
  await createMessage(supabase, user.id, conversationId, {
    role: 'user',
    content,
    citations: [],
    status: 'complete',
    ttft_ms: null,
  })

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
        let literatureEvidence: LiteratureEvidenceMatch[] = []

        const send = (event: string, data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        }

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
            onEvent: (event, data) => {
              if (event === 'delta' && ttftMs === null) ttftMs = Date.now() - startedAt
              send(event, event === 'tool-complete' ? activityPayload(data) : data)
            },
          })
          answer = result.answer
          literatureCitations = result.citations
          literatureEvidence = result.evidence
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

          await createMessage(supabase, user.id, conversationId, {
            role: 'assistant',
            content: answer || (status === 'cancelled' ? 'Response cancelled.' : 'Unable to generate a response.'),
            citations: citationIds,
            status,
            ttft_ms: ttftMs,
          })

          send('done', { status, ttftMs, citationIds, evidence: literatureEvidence })
          controller.close()
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
