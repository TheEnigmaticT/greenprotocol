import { createConfiguredChatProvider } from '@/lib/talk-about-this/chat-provider'
import { buildTalkAboutSystemPrompt } from '@/lib/talk-about-this/prompt'
import { createMessage, listConversationMessages, loadOwnedConversation } from '@/lib/talk-about-this/repository'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

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

        const send = (event: string, data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        }

        try {
          send('conversation', { conversationId })
          for await (const event of provider.stream({
            system: buildTalkAboutSystemPrompt(conversation.context_snapshot),
            messages: [
              ...previousMessages.slice(-12).map(message => ({ role: message.role, content: message.content })),
              { role: 'user', content },
            ],
            signal: abortController.signal,
          })) {
            if (ttftMs === null) {
              ttftMs = Date.now() - startedAt
            }
            answer += event.text
            send('delta', { text: event.text })
          }
        } catch {
          status = abortController.signal.aborted ? 'cancelled' : 'failed'
          send('error', {
            error: status === 'cancelled' ? 'Response cancelled' : 'Chat response failed',
          })
        } finally {
          const citationIds = conversation.context_snapshot.citations
            .filter(citation => answer.includes(`[${citation.id}]`))
            .map(citation => citation.id)

          await createMessage(supabase, user.id, conversationId, {
            role: 'assistant',
            content: answer || (status === 'cancelled' ? 'Response cancelled.' : 'Unable to generate a response.'),
            citations: citationIds,
            status,
            ttft_ms: ttftMs,
          })

          send('done', { status, ttftMs, citationIds })
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
