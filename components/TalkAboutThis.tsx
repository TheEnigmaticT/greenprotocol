'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import type { TalkAboutScope } from '@/lib/talk-about-this/context'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  citations?: string[]
}

interface TalkAboutThisProps {
  analysisId?: string
  scope: TalkAboutScope
  title: string
  evidenceState: 'sourced' | 'inferred'
}

function parseSseEvent(block: string): { event: string; data: Record<string, unknown> } | null {
  const eventLine = block.split('\n').find(line => line.startsWith('event: '))
  const dataLine = block.split('\n').find(line => line.startsWith('data: '))
  if (!eventLine || !dataLine) return null

  try {
    return {
      event: eventLine.slice(7),
      data: JSON.parse(dataLine.slice(6)) as Record<string, unknown>,
    }
  } catch {
    return null
  }
}

export function TalkAboutThis({ analysisId, scope, title, evidenceState }: TalkAboutThisProps) {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const openConversation = async () => {
    if (!analysisId) return
    setIsStarting(true)
    setError(null)
    try {
      const response = await fetch('/api/talk-about-this', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisId, scope }),
      })
      const body = await response.json() as { conversationId?: string; error?: string }
      if (!response.ok || !body.conversationId) {
        throw new Error(body.error || 'Unable to open chat')
      }
      setConversationId(body.conversationId)
      setMessages([])
      setIsOpen(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to open chat')
    } finally {
      setIsStarting(false)
    }
  }

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = draft.trim()
    if (!conversationId || !content || isSending) return

    setDraft('')
    setError(null)
    setIsSending(true)
    setMessages(current => [...current, { role: 'user', content }, { role: 'assistant', content: '' }])

    const abortController = new AbortController()
    abortRef.current = abortController
    try {
      const response = await fetch(`/api/talk-about-this/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        signal: abortController.signal,
      })
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({ error: 'Unable to start chat' })) as { error?: string }
        throw new Error(body.error || 'Unable to start chat')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          const parsed = parseSseEvent(block)
          if (!parsed) continue
          if (parsed.event === 'delta' && typeof parsed.data.text === 'string') {
            setMessages(current => current.map((message, index) =>
              index === current.length - 1 ? { ...message, content: message.content + parsed.data.text } : message,
            ))
          }
          const citationIds = parsed.data.citationIds
          if (parsed.event === 'done' && Array.isArray(citationIds)) {
            const validatedCitationIds = citationIds.filter((id): id is string => typeof id === 'string')
            setMessages(current => current.map((message, index) =>
              index === current.length - 1
                ? { ...message, citations: validatedCitationIds }
                : message,
            ))
          }
          if (parsed.event === 'error' && typeof parsed.data.error === 'string') {
            setError(parsed.data.error)
          }
        }
      }
    } catch (caught) {
      if (!abortController.signal.aborted) {
        setError(caught instanceof Error ? caught.message : 'Unable to send message')
      }
    } finally {
      abortRef.current = null
      setIsSending(false)
    }
  }

  const close = () => {
    abortRef.current?.abort()
    setIsOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={openConversation}
        disabled={!analysisId || isStarting}
        className="text-xs px-3 py-1.5 rounded border font-bold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{ color: '#1C3822', borderColor: '#2D4A3A', background: '#F6F3EB' }}
      >
        {isStarting ? 'Opening…' : 'Chat about this'}
      </button>
      {error && !isOpen && <p className="mt-2 text-xs" style={{ color: '#B45309' }}>{error}</p>}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Chat about ${title}`}>
          <button type="button" className="absolute inset-0 bg-black/30" onClick={close} aria-label="Close chat" />
          <section className="relative flex h-full w-full max-w-xl flex-col border-l shadow-2xl" style={{ background: '#FAFAF8', borderColor: '#D6D0C4' }}>
            <header className="border-b p-5" style={{ borderColor: '#D6D0C4', background: '#F6F3EB' }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#78716C' }}>Scoped scientific discussion</p>
                  <h2 className="mt-1 text-lg font-bold font-[family-name:var(--font-serif)]" style={{ color: '#1C1917' }}>{title}</h2>
                  <p className="mt-1 text-xs" style={{ color: '#57534E' }}>
                    {evidenceState === 'sourced' ? 'Direct evidence is included in this discussion.' : 'Model-inferred — no direct evidence located.'}
                  </p>
                </div>
                <button type="button" onClick={close} className="text-sm font-bold" style={{ color: '#57534E' }}>Close</button>
              </div>
              <p className="mt-3 text-xs" style={{ color: '#78716C' }}>This discussion does not change the analysis or its acceptance state.</p>
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
              {messages.length === 0 && <p className="text-sm" style={{ color: '#57534E' }}>Ask why this was recommended, challenge an assumption, or describe a laboratory constraint.</p>}
              {messages.map((message, index) => (
                <article key={`${message.role}-${index}`} className="rounded-lg p-3 text-sm" style={{ background: message.role === 'user' ? '#1C3822' : '#FFFFFF', color: message.role === 'user' ? '#F6F3EB' : '#1C1917', border: message.role === 'assistant' ? '1px solid #E7E5E4' : undefined }}>
                  <p className="whitespace-pre-wrap">{message.content || 'Thinking…'}</p>
                  {message.citations && message.citations.length > 0 && <p className="mt-2 text-[10px]" style={{ color: '#78716C' }}>Sources: {message.citations.join(' · ')}</p>}
                </article>
              ))}
              {error && <p className="text-xs" style={{ color: '#B45309' }}>{error}</p>}
            </div>
            <form onSubmit={sendMessage} className="border-t p-4" style={{ borderColor: '#D6D0C4' }}>
              <label className="sr-only" htmlFor="talk-about-this-message">Message</label>
              <textarea id="talk-about-this-message" value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} rows={3} placeholder="Ask about this recommendation…" className="w-full rounded border p-3 text-sm" style={{ borderColor: '#D6D0C4', color: '#1C1917' }} disabled={isSending} />
              <div className="mt-2 flex items-center justify-between gap-3">
                <button type="button" onClick={() => abortRef.current?.abort()} disabled={!isSending} className="text-xs font-bold uppercase tracking-wider disabled:opacity-50" style={{ color: '#78716C' }}>Stop</button>
                <button type="submit" disabled={!draft.trim() || isSending} className="rounded px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50" style={{ background: '#1C3822', color: '#F6F3EB' }}>{isSending ? 'Responding…' : 'Send'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  )
}
