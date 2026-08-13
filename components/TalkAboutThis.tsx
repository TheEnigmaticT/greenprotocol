'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FormEvent, useEffect, useRef, useState } from 'react'
import type { TalkAboutScope } from '@/lib/talk-about-this/context'
import type { LiteratureEvidenceMatch } from '@/lib/types'
import { isPersistedEvidence } from '@/lib/talk-about-this/evidence'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  citations?: string[]
}

interface ChatActivity {
  callId: string
  label: string
  state: 'thinking' | 'running' | 'complete' | 'failed'
  detail?: string
}


interface EvidenceReceipt {
  evidence: LiteratureEvidenceMatch
  receivedAt: string
}
type TerminalStatus = 'complete' | 'failed' | 'cancelled'

export interface RecommendationApprovalReceipt {
  recommendationId: string
  label: string
  alreadyAccepted: boolean
  actionId: string
  revisionNumber: number
}

export interface PersistedRecommendationApprovalReceipt extends RecommendationApprovalReceipt {
  receivedAt: string
}

export function parsePersistedRecommendationApprovalReceipt(
  scope: TalkAboutScope,
  receipt: unknown,
): PersistedRecommendationApprovalReceipt | null {
  if (!receipt || typeof receipt !== 'object') return null
  const { receivedAt, ...event } = receipt as Record<string, unknown>
  const approval = parseRecommendationApprovedEvent(scope, event)
  if (!approval || typeof receivedAt !== 'string' || !receivedAt.trim()) return null
  return { ...approval, receivedAt }
}

export function approvalFromEvent(
  data: Record<string, unknown>,
  scope: TalkAboutScope,
): { recommendationId: string; label: string; revisionNumber: number } | null {
  if (scope.kind !== 'recommendation' || !('recommendationId' in scope)) return null

  const recommendationId = data.recommendationId
  const label = data.label
  const revisionNumber = data.revisionNumber
  if (
    recommendationId !== scope.recommendationId
    || typeof label !== 'string'
    || !label.trim()
    || typeof revisionNumber !== 'number'
    || !Number.isSafeInteger(revisionNumber)
    || revisionNumber < 0
  ) return null

  return { recommendationId, label, revisionNumber }
}

export function parseRecommendationApprovedEvent(
  scope: TalkAboutScope,
  data: Record<string, unknown>,
): RecommendationApprovalReceipt | null {
  const approval = approvalFromEvent(data, scope)
  const alreadyAccepted = data.alreadyAccepted
  const actionId = data.actionId
  if (
    !approval
    || typeof alreadyAccepted !== 'boolean'
    || typeof actionId !== 'string'
    || !actionId.trim()
  ) return null

  return { ...approval, alreadyAccepted, actionId }
}

export function applyRecommendationApprovedEvent(
  scope: TalkAboutScope,
  data: Record<string, unknown>,
  notifiedActionIds: ReadonlySet<string>,
): { receipt: RecommendationApprovalReceipt | null; shouldNotifyParent: boolean } {
  const receipt = parseRecommendationApprovedEvent(scope, data)
  return {
    receipt,
    shouldNotifyParent: Boolean(receipt && !notifiedActionIds.has(receipt.actionId)),
  }
}

function isLiteratureEvidence(value: unknown): value is LiteratureEvidenceMatch {
  return isPersistedEvidence(value)
}

export function evidenceFromEvent(event: string, data: Record<string, unknown>): LiteratureEvidenceMatch[] {
  if (event !== 'tool-complete' && event !== 'done') return []
  return Array.isArray(data.evidence)
    ? data.evidence.filter(isLiteratureEvidence)
    : []
}

function showReadyNotification(title: string, status: TerminalStatus) {
  if (
    document.visibilityState !== 'hidden'
    || typeof Notification === 'undefined'
    || Notification.permission !== 'granted'
  ) return
  new Notification('GC.ai response ready', {
    body: status === 'complete' ? `Your scoped discussion about ${title} is ready.` : `Your scoped discussion about ${title} did not complete.`,
  })
}

function sourceLabels(tool: string, data: Record<string, unknown>): string {
  const values = [
    typeof data.source === 'string' ? data.source : '',
    ...(Array.isArray(data.datasetSources)
      ? data.datasetSources.filter((source): source is string => typeof source === 'string')
      : []),
  ].join(' ').toLowerCase()
  const labels: string[] = []

  if (values.includes('chem21')) labels.push('CHEM21')
  if (values.includes('mixturesoldb')) labels.push('MixtureSolDB')
  if (values.includes('densit')) labels.push('density')
  else if (values.includes('bigsoldb')) labels.push('BigSolDB')
  if (values.includes('pubchem') || values.includes('ghs') || tool === 'lookup_solvent_hazard_profile') {
    labels.push('PubChem GHS')
  }

  return labels.length > 0 ? labels.join(' · ') : 'local evidence'
}

function labelForTool(tool: string, source: string, status: string): string {
  if (tool === 'search_scoped_literature_evidence') return 'Received scoped literature evidence'
  if (tool === 'screen_solvent_candidates') return 'Received local solvent screening evidence'
  if (tool === 'lookup_chem21_solvent') return 'Received CHEM21 solvent evidence'
  if (tool === 'lookup_experimental_solvent_evidence') return 'Received local solvent measurement evidence'
  if (tool === 'lookup_solvent_hazard_profile') {
    return status === 'ok' ? 'Received PubChem GHS hazard profile' : `${source} profile unavailable`
  }
  if (tool === 'lookup_pubchem_profile') return 'Received PubChem profile'
  if (tool === 'calculate_rdkit_properties') return 'Received calculated molecular properties'
  return `Received ${tool.replaceAll('_', ' ')}`
}

function statusLabel(status: string): string {
  if (status === 'ok') return 'available'
  if (status === 'not_found') return 'not found'
  if (status === 'unavailable') return 'unavailable'
  return 'reported'
}

function measurementSummary(data: Record<string, unknown>): string | null {
  const count = data.measurementCount
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null
  return `${count} measurement${count === 1 ? '' : 's'}`
}

export function activityForEvent(event: string, data: Record<string, unknown>): ChatActivity | null {
  const callId = typeof data.callId === 'string' ? data.callId : `activity-${event}`
  const tool = typeof data.tool === 'string' ? data.tool : 'scientific_source'
  if (event === 'activity') return { callId, state: 'thinking', label: 'Thinking with the scoped evidence' }
  if (event === 'tool-start') return { callId, state: 'running', label: `Looking up ${tool.replaceAll('_', ' ')}` }
  if (event === 'tool-complete') {
    const status = typeof data.status === 'string' ? data.status : 'reported'
    const source = sourceLabels(tool, data)
    const details = [`Source: ${source}`, `Status: ${statusLabel(status)}`]
    const measurement = measurementSummary(data)
    if (measurement) details.push(measurement)
    if (typeof data.classification === 'string' && data.classification) {
      details.push(`Classification: ${data.classification}`)
    }
    if (tool === 'screen_solvent_candidates' && status === 'ok') {
      details.push('Laboratory compatibility validation required.')
    }
    if (source.includes('PubChem GHS') && status !== 'ok') {
      details.push('GHS information is unknown, not safe.')
    }
    const warning = Array.isArray(data.warnings) && typeof data.warnings[0] === 'string'
      ? data.warnings[0]
      : null
    if (warning) details.push(`Warning: ${warning}`)

    return {
      callId,
      state: status === 'ok' ? 'complete' : 'failed',
      label: labelForTool(tool, source, status),
      detail: details.join(' · '),
    }
  }
  if (event === 'tool-failed') {
    const source = sourceLabels(tool, data)
    return {
      callId,
      state: 'failed',
      label: `${tool.replaceAll('_', ' ')} unavailable`,
      detail: `Source: ${source} · Status: unavailable · ${typeof data.reason === 'string' ? data.reason : 'The lookup could not be completed.'}`,
    }
  }
  return null
}

export function DiscussionScopeInstruction({ scope }: { scope: TalkAboutScope }) {
  const canApprove = scope.kind === 'recommendation' && 'recommendationId' in scope
  return (
    <p className="mt-3 text-xs" style={{ color: '#78716C' }}>
      {canApprove
        ? 'You may explicitly approve this scoped recommendation by sending ‘approve this’; other analysis changes are unavailable.'
        : 'This discussion does not change the analysis or its acceptance state.'}
    </p>
  )
}

export function EvidenceReceiptCard({ evidence, receivedAt }: EvidenceReceipt) {
  const isCandidate = evidence.candidateStatus === 'candidate_pending_adjudication'
    || evidence.candidateStatus === 'candidate'

  return (
    <article className="rounded-lg border p-3 text-xs space-y-1" style={{ borderColor: '#D6D0C4', background: '#F6F3EB', color: '#1C1917' }}>
      <p className="font-bold" style={{ color: '#1C3822' }}>{isCandidate ? 'Candidate evidence' : 'Adjudicated evidence'}</p>
      <p><strong>{evidence.sourceDocumentId}</strong> · {evidence.title} · pp. {evidence.pageStart}{evidence.pageEnd === evidence.pageStart ? '' : `–${evidence.pageEnd}`}</p>
      <blockquote className="border-l-2 pl-2" style={{ borderColor: '#A8C5A2', color: '#57534E' }}>{evidence.quote}</blockquote>
      <p>Status: {evidence.candidateStatus}. Retrieved {new Date(receivedAt).toLocaleString()}.</p>
      {evidence.applicability && <p>Applicability: {evidence.applicability}</p>}
      {evidence.limitations && <p>Limitations: {evidence.limitations}</p>}
    </article>
  )
}

export function ClosedConversationError({ error, isOpen }: { error: string | null; isOpen: boolean }) {
  if (isOpen || !error) return null

  return <p role="alert" className="mt-2 text-xs" style={{ color: '#B45309' }}>{error}</p>
}

export function ApprovalReceiptCard({
  receipt,
  receivedAt,
}: {
  receipt: RecommendationApprovalReceipt
  receivedAt: string | null
}) {
  return (
    <p className="rounded border p-3 text-xs" style={{ borderColor: '#BBF7D0', background: '#F0FDF4', color: '#166534' }}>
      {receipt.label} {receipt.alreadyAccepted ? 'was already approved.' : 'has been approved.'}
      {' '}Receipt {receipt.actionId} · revision {receipt.revisionNumber}
      {receivedAt && ` · ${new Date(receivedAt).toLocaleString()}`}
    </p>
  )
}

interface TalkAboutThisProps {
  analysisId?: string
  scope: TalkAboutScope
  title: string
  evidenceState: 'sourced' | 'inferred'
  buttonLabel?: string
  onRecommendationApproved?: (receipt: RecommendationApprovalReceipt) => void
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
export function TalkAboutThis({ analysisId, scope, title, evidenceState, onRecommendationApproved, buttonLabel = 'Chat about this' }: TalkAboutThisProps) {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [activities, setActivities] = useState<ChatActivity[]>([])
  const [notifyOnReady, setNotifyOnReady] = useState(false)
  const [approvalReceipt, setApprovalReceipt] = useState<RecommendationApprovalReceipt | null>(null)
  const [evidenceReceipts, setEvidenceReceipts] = useState<EvidenceReceipt[]>([])
  const [approvalReceivedAt, setApprovalReceivedAt] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null)
  const sendLockedRef = useRef(false)
  const approvedActionIdsRef = useRef(new Set<string>())

  const close = () => {
    abortRef.current?.abort()
    setIsOpen(false)
  }

  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    if (!isOpen) return
    messageInputRef.current?.focus()
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen])

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
      const body = await response.json() as {
        conversationId?: string
        approvalReceipt?: unknown
        error?: string
      }
      if (!response.ok || !body.conversationId) {
        throw new Error(body.error || 'Unable to open chat')
      }
      setConversationId(body.conversationId)
      setMessages([])
      setEvidenceReceipts([])
      const persistedReceipt = parsePersistedRecommendationApprovalReceipt(scope, body.approvalReceipt)
      setApprovalReceipt(persistedReceipt)
      setApprovalReceivedAt(persistedReceipt?.receivedAt ?? null)
      approvedActionIdsRef.current = new Set(persistedReceipt ? [persistedReceipt.actionId] : [])
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
    if (!conversationId || !content || isSending || sendLockedRef.current) return
    sendLockedRef.current = true
    // Keep a durable approval receipt visible while the follow-up response streams.

    setDraft('')
    setActivities([])
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
      let terminalStatus: TerminalStatus | null = null
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
          const incomingEvidence = evidenceFromEvent(parsed.event, parsed.data)
          if (incomingEvidence.length > 0) {
            const receivedAt = new Date().toISOString()
            setEvidenceReceipts(current => {
              const knownIds = new Set(current.map(receipt => receipt.evidence.id))
              const additions = incomingEvidence
                .filter(evidence => !knownIds.has(evidence.id))
                .map(evidence => ({ evidence, receivedAt }))
              return additions.length > 0 ? [...current, ...additions] : current
            })
          }
          const activity = activityForEvent(parsed.event, parsed.data)
          if (activity) {
            setActivities(current => {
              const existingIndex = current.findIndex(item => item.callId === activity.callId)
              if (existingIndex === -1) return [...current, activity]
              return current.map((item, index) => index === existingIndex ? activity : item)
            })
          }
          const citationIds = parsed.data.citationIds
          if (parsed.event === 'done' && Array.isArray(citationIds)) {
            const validatedCitationIds = citationIds.filter((id): id is string => typeof id === 'string')
            terminalStatus = parsed.data.status === 'failed' || parsed.data.status === 'cancelled'
              ? parsed.data.status
              : 'complete'
            setMessages(current => current.map((message, index) =>
              index === current.length - 1
                ? { ...message, citations: validatedCitationIds }
                : message,
            ))
          }
          if (parsed.event === 'recommendation-approved') {
            const approval = applyRecommendationApprovedEvent(scope, parsed.data, approvedActionIdsRef.current)
            if (approval.receipt) {
              setApprovalReceipt(approval.receipt)
              if (approval.shouldNotifyParent) {
                approvedActionIdsRef.current.add(approval.receipt.actionId)
                setApprovalReceivedAt(new Date().toISOString())
                onRecommendationApproved?.(approval.receipt)
              }
            }
          }
          if (parsed.event === 'error' && typeof parsed.data.error === 'string') {
            const errorMessage = parsed.data.error
            setError(errorMessage)
            setActivities(current => {
              const failed: ChatActivity = {
                callId: 'response-error',
                state: 'failed',
                label: 'Response unavailable',
                detail: errorMessage,
              }
              return current.length === 0
                ? [failed]
                : current.map(activity => activity.state === 'thinking' || activity.state === 'running'
                  ? { ...activity, state: 'failed', detail: errorMessage }
                  : activity)
            })
          }
        }
      }
      if (terminalStatus && notifyOnReady) showReadyNotification(title, terminalStatus)
    } catch (caught) {
      if (!abortController.signal.aborted) {
        setError(caught instanceof Error ? caught.message : 'Unable to send message')
      }
    } finally {
      abortRef.current = null
      sendLockedRef.current = false
      setIsSending(false)
    }
  }


  return (
    <>
      <button
        type="button"
        onClick={openConversation}
        disabled={!analysisId || isStarting}
        className="text-xs px-3 py-1.5 rounded border font-bold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{ color: '#1C3822', borderColor: '#2D4A3A', background: '#F6F3EB' }}
        aria-label={`${buttonLabel}. ${evidenceState === 'sourced' ? 'Direct evidence is included in this discussion.' : 'Model-inferred — no direct evidence located.'}`}
      >
        {isStarting ? 'Opening…' : buttonLabel}
      </button>
      <ClosedConversationError error={error} isOpen={isOpen} />
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
              <DiscussionScopeInstruction scope={scope} />
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
              {approvalReceipt && <ApprovalReceiptCard receipt={approvalReceipt} receivedAt={approvalReceivedAt} />}
              {evidenceReceipts.map(receipt => (
                <EvidenceReceiptCard key={receipt.evidence.id} {...receipt} />
              ))}
              {messages.map((message, index) => (
                <article key={`${message.role}-${index}`} className="rounded-lg p-3 text-sm" style={{ background: message.role === 'user' ? '#1C3822' : '#FFFFFF', color: message.role === 'user' ? '#F6F3EB' : '#1C1917', border: message.role === 'assistant' ? '1px solid #E7E5E4' : undefined }}>
                  {message.role === 'assistant'
                    ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        skipHtml
                        components={{
                          a: ({ children }) => <span>{children}</span>,
                          img: ({ alt }) => <span>{alt}</span>,
                        }}
                      >
                        {message.content || 'Thinking…'}
                      </ReactMarkdown>
                    )
                    : <p className="whitespace-pre-wrap">{message.content}</p>}
                  {message.citations && message.citations.length > 0 && <p className="mt-2 text-[10px]" style={{ color: '#78716C' }}>Sources: {message.citations.join(' · ')}</p>}
                </article>
              ))}
              {(isSending || activities.length > 0) && (
                <section aria-label="Scientific lookup activity" className="rounded-lg border p-3 text-xs" style={{ borderColor: '#D6D0C4', background: '#F6F3EB', color: '#57534E' }}>
                  {isSending && activities.length === 0 && <p><span className="inline-block animate-pulse" aria-hidden="true">●</span> Preparing the scoped response…</p>}
                  {activities.map(activity => (
                    <p key={activity.callId} className="mt-1">
                      <span className={activity.state === 'thinking' || activity.state === 'running' ? 'inline-block animate-pulse' : ''} aria-hidden="true">
                        {activity.state === 'complete' ? '✓' : activity.state === 'failed' ? '!' : '●'}
                      </span>
                      {' '}{activity.label}{activity.detail ? ` — ${activity.detail}` : ''}
                    </p>
                  ))}
                </section>
              )}
              {error && <p className="text-xs" style={{ color: '#B45309' }}>{error}</p>}
            </div>
            <form onSubmit={sendMessage} className="border-t p-4" style={{ borderColor: '#D6D0C4' }}>
              <label className="sr-only" htmlFor="talk-about-this-message">Message</label>
              {typeof Notification !== 'undefined' && (
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs" style={{ color: '#57534E' }}>
                  <input
                    type="checkbox"
                    checked={notifyOnReady}
                    onChange={async event => {
                      if (!event.target.checked) {
                        setNotifyOnReady(false)
                        return
                      }
                      const permission = Notification.permission === 'default'
                        ? await Notification.requestPermission()
                        : Notification.permission
                      if (permission !== 'granted') {
                        setError('Response notifications were not enabled.')
                        return
                      }
                      setNotifyOnReady(true)
                    }}
                  />
                  Notify me when a background response is ready
                </label>
              )}
              <textarea ref={messageInputRef} id="talk-about-this-message" value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} rows={3} placeholder="Ask about this recommendation…" className="w-full rounded border p-3 text-sm" style={{ borderColor: '#D6D0C4', color: '#1C1917' }} disabled={isSending} />
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
