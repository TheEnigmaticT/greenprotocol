'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState, type CSSProperties } from 'react'
import { canDecideRecommendation, parseTalkAboutScope, scopesEqual, type TalkAboutScope } from '@/lib/talk-about-this/scope'
import type { LiteratureEvidenceMatch } from '@/lib/types'
import { isPersistedEvidence, type PersistedEvidenceReceipt } from '@/lib/talk-about-this/evidence'
import type { PersistedChatMessage, PersistedRecommendationDecisionReceipt } from '@/lib/talk-about-this/repository'
import { parseRecommendationDecisionReceipt, type RecommendationDecisionReceipt } from '@/lib/talk-about-this/decisions'
import { parseProcedureProposal, type ProcedureProposal } from '@/lib/talk-about-this/procedure-proposal'
type ChatMessage = PersistedChatMessage

interface ChatActivity {
  callId: string
  label: string
  state: 'thinking' | 'running' | 'complete' | 'failed'
  detail?: string
}


type EvidenceReceipt = PersistedEvidenceReceipt
type TerminalStatus = 'complete' | 'failed' | 'cancelled'

export type { RecommendationDecisionReceipt, ProcedureProposal }

export interface VerificationNote {
  source: string
  reasonCode: string
  text: string
}

export interface GroupedVerificationNote extends VerificationNote {
  count: number
}

interface OpenConversationResponse {
  conversationId: string
  scope: TalkAboutScope
  contextHash: string
  noDirectEvidence: boolean
  disposition: 'created' | 'resumed'
  messages: ChatMessage[]
  evidenceReceipts: EvidenceReceipt[]
  decisionReceipt: PersistedRecommendationDecisionReceipt | null
  proposals: ProcedureProposal[]
}

export function isNewConversationCommand(value: string): boolean {
  const command = value.trim()
  return command === '/new' || command === '/clear'
}

export function verificationNoteFromEvent(
  event: string,
  data: Record<string, unknown>,
): VerificationNote | null {
  if (
    event !== 'tool-failed'
    || typeof data.tool !== 'string'
    || !data.tool.trim()
    || typeof data.status !== 'string'
    || !data.status.trim()
    || typeof data.source !== 'string'
    || !data.source.trim()
    || typeof data.reasonCode !== 'string'
    || !data.reasonCode.trim()
    || typeof data.userNote !== 'string'
    || !data.userNote.trim()
  ) return null

  return {
    source: data.source,
    reasonCode: data.reasonCode,
    text: data.userNote,
  }
}

export function groupVerificationNotes(
  notes: readonly VerificationNote[],
): GroupedVerificationNote[] {
  const groups = new Map<string, GroupedVerificationNote>()

  for (const note of notes) {
    const key = `${note.source}:${note.reasonCode}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
    } else {
      groups.set(key, { ...note, count: 1 })
    }
  }

  return [...groups.values()]
}

export function handleComposerKeyDown(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  isSending: boolean,
  draft: string,
) {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  if (!isSending && draft.trim()) event.currentTarget.form?.requestSubmit()
}

export function focusMessageComposer(
  ref: { current: Pick<HTMLTextAreaElement, 'focus'> | null },
) {
  ref.current?.focus()
}

function isPersistedChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>

  return typeof message.id === 'string'
    && Boolean(message.id.trim())
    && (message.role === 'user' || message.role === 'assistant')
    && typeof message.content === 'string'
    && Array.isArray(message.citations)
    && message.citations.every(citation => typeof citation === 'string')
    && (message.status === 'streaming'
      || message.status === 'complete'
      || message.status === 'failed'
      || message.status === 'cancelled')
    && (message.ttftMs === null || (typeof message.ttftMs === 'number' && Number.isFinite(message.ttftMs)))
    && typeof message.createdAt === 'string'
    && Boolean(message.createdAt.trim())
}

function isEvidenceReceipt(value: unknown): value is EvidenceReceipt {
  if (!value || typeof value !== 'object') return false
  const receipt = value as Record<string, unknown>
  return isPersistedEvidence(receipt.evidence)
    && typeof receipt.receivedAt === 'string'
    && Boolean(receipt.receivedAt.trim())
}

export function parseOpenConversationResponse(
  scope: TalkAboutScope,
  value: unknown,
): OpenConversationResponse | null {
  if (!value || typeof value !== 'object') return null
  const response = value as Record<string, unknown>
  const decisionReceipt = response.decisionReceipt === null
    ? null
    : parsePersistedRecommendationDecisionReceipt(scope, response.decisionReceipt)
  const proposals = Array.isArray(response.proposals)
    ? response.proposals.map(parseProcedureProposal)
    : null

  let responseScope: TalkAboutScope
  try {
    responseScope = parseTalkAboutScope(response.scope)
  } catch {
    return null
  }

  if (
    typeof response.conversationId !== 'string'
    || !response.conversationId.trim()
    || !scopesEqual(scope, responseScope)
    || typeof response.contextHash !== 'string'
    || !response.contextHash.trim()
    || typeof response.noDirectEvidence !== 'boolean'
    || (response.disposition !== 'created' && response.disposition !== 'resumed')
    || !Array.isArray(response.messages)
    || !response.messages.every(isPersistedChatMessage)
    || !Array.isArray(response.evidenceReceipts)
    || !response.evidenceReceipts.every(isEvidenceReceipt)
    || (response.decisionReceipt !== null && !decisionReceipt)
    || !proposals
    || proposals.some(proposal => proposal === null)
  ) return null

  return {
    conversationId: response.conversationId,
    scope: responseScope,
    contextHash: response.contextHash,
    noDirectEvidence: response.noDirectEvidence,
    disposition: response.disposition,
    messages: response.messages,
    evidenceReceipts: response.evidenceReceipts,
    decisionReceipt,
    proposals: proposals.filter((proposal): proposal is ProcedureProposal => proposal !== null),
  }
}

export function parsePersistedRecommendationDecisionReceipt(
  scope: TalkAboutScope,
  receipt: unknown,
): PersistedRecommendationDecisionReceipt | null {
  if (!receipt || typeof receipt !== 'object') return null
  const { receivedAt, ...event } = receipt as Record<string, unknown>
  const decision = parseRecommendationDecidedEvent(scope, event)
  if (!decision || typeof receivedAt !== 'string' || !receivedAt.trim()) return null
  return { ...decision, receivedAt }
}

/** A receipt only counts for the stable recommendation this conversation is about. */
export function parseRecommendationDecidedEvent(
  scope: TalkAboutScope,
  data: Record<string, unknown>,
): RecommendationDecisionReceipt | null {
  if (!canDecideRecommendation(scope)) return null
  const receipt = parseRecommendationDecisionReceipt(data)
  return receipt && receipt.recommendationId === scope.recommendationId ? receipt : null
}

export function applyRecommendationDecidedEvent(
  scope: TalkAboutScope,
  data: Record<string, unknown>,
  notifiedActionIds: ReadonlySet<string>,
): { receipt: RecommendationDecisionReceipt | null; shouldNotifyParent: boolean } {
  const receipt = parseRecommendationDecidedEvent(scope, data)
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
    if (status === 'ok') return 'Received PubChem GHS hazard profile'
    if (status === 'not_found') return 'No local GHS snapshot for this solvent'
    return `${source} profile unavailable`
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
  if (tool === 'propose_procedure_edit') {
    if (event === 'tool-start') return { callId, state: 'running', label: 'Preparing a proposed change to your procedure' }
    if (event === 'tool-complete') return { callId, state: 'complete', label: 'Proposed change ready for your review' }
    if (event === 'tool-failed') return { callId, state: 'failed', label: 'The proposed change could not be matched to your procedure' }
  }
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
    // True unavailability (timeout/error) stays unknown-not-safe. A local-index
    // miss is expected until the GHS harvest is complete — do not alarm on it.
    if (source.includes('PubChem GHS') && status === 'unavailable') {
      details.push('GHS information is unknown, not safe.')
    }
    const warning = Array.isArray(data.warnings) && typeof data.warnings[0] === 'string'
      ? data.warnings[0]
      : null
    if (warning) details.push(`Warning: ${warning}`)

    const succeeded = status === 'ok' || status === 'not_found'
    return {
      callId,
      state: succeeded ? 'complete' : 'failed',
      label: labelForTool(tool, source, status),
      detail: details.join(' · '),
    }
  }
  if (event === 'tool-failed') {
    return {
      callId,
      state: 'failed',
      label: `${tool.replaceAll('_', ' ')} unavailable`,
    }
  }
  return null
}

export function DiscussionScopeInstruction({ scope }: { scope: TalkAboutScope }) {
  let guidance: string
  if (canDecideRecommendation(scope)) {
    guidance = 'You can approve or reject this recommendation with the buttons under the message box, or by sending ‘approve this’ or ‘reject this’. If you ask for a change to your procedure, you review it first; nothing changes until you press Apply.'
  } else if (scope.kind === 'recommendation') {
    guidance = 'This discussion is read-only. It does not change the analysis or its recommendations.'
  } else {
    guidance = 'This chat does not change your analysis by itself. If you ask for a change to your procedure, you review it first; nothing changes until you press Apply.'
  }
  return (
    <p className="mt-3 text-xs" style={{ color: '#78716C' }}>{guidance}</p>
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

export function DecisionReceiptCard({
  receipt,
  receivedAt,
}: {
  receipt: RecommendationDecisionReceipt
  receivedAt: string | null
}) {
  const verb = receipt.decision === 'approved' ? 'approved' : 'rejected'
  return (
    <p
      className="rounded border p-3 text-xs"
      style={receipt.decision === 'approved'
        ? { borderColor: '#BBF7D0', background: '#F0FDF4', color: '#166534' }
        : { borderColor: '#D6D0C4', background: '#F6F3EB', color: '#44403C' }}
    >
      {receipt.label} {receipt.alreadyDecided ? `was already ${verb}.` : `has been ${verb}.`}
      {' '}Saved to your analysis
      {receivedAt && ` · ${new Date(receivedAt).toLocaleString()}`}
    </p>
  )
}

const APPROVE_PHRASE = 'approve this'
const REJECT_PHRASE = 'reject this'

/** Quick actions that send the exact phrases the server recognises; the model is never involved. */
export function DecisionActions({
  scope,
  disabled,
  onDecide,
}: {
  scope: TalkAboutScope
  disabled: boolean
  onDecide: (phrase: string) => void
}) {
  if (!canDecideRecommendation(scope)) return null

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Decide on this recommendation">
      <button
        type="button"
        onClick={() => onDecide(APPROVE_PHRASE)}
        disabled={disabled}
        className="min-h-11 rounded px-4 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
        style={{ background: '#1C3822', color: '#F6F3EB' }}
      >
        Approve this
      </button>
      <button
        type="button"
        onClick={() => onDecide(REJECT_PHRASE)}
        disabled={disabled}
        className="min-h-11 rounded border px-4 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
        style={{ borderColor: '#D6D0C4', background: '#FFFFFF', color: '#1C1917' }}
      >
        Reject this
      </button>
    </div>
  )
}

export function diffLines(diff: string): { kind: 'add' | 'remove' | 'hunk' | 'context'; text: string }[] {
  return diff.split('\n').map(line => {
    if (line.startsWith('@@')) return { kind: 'hunk', text: line }
    if (line.startsWith('+')) return { kind: 'add', text: line.slice(1) }
    if (line.startsWith('-')) return { kind: 'remove', text: line.slice(1) }
    return { kind: 'context', text: line.slice(1) }
  })
}

const DIFF_LINE_STYLES = {
  add: { background: '#F0FDF4', color: '#166534' },
  remove: { background: '#FEF2F2', color: '#991B1B' },
  hunk: { background: '#F6F3EB', color: '#78716C' },
  context: { color: '#44403C' },
} satisfies Record<string, CSSProperties>

const DIFF_LINE_PREFIX = { add: '+ ', remove: '− ', hunk: '', context: '  ' } as const

export function ProposalCard({
  proposal,
  status,
  error,
  canApply,
  onApply,
  onCancel,
}: {
  proposal: ProcedureProposal
  status: ProposalStatus
  error: string | null
  canApply: boolean
  onApply: () => void
  onCancel: () => void
}) {
  const isBusy = status === 'applying' || status === 'cancelling'
  const isOpen = status === 'pending' || status === 'confirmed' || isBusy
  return (
    <section aria-label="Proposed procedure change" className="rounded-lg border p-3 text-xs space-y-2" style={{ borderColor: '#ECB815', background: '#FFFDF5', color: '#1C1917' }}>
      <p className="font-bold" style={{ color: '#1C3822' }}>Proposed change to your procedure</p>
      <p>{proposal.summary}</p>
      <pre className="max-h-64 overflow-auto rounded border p-2 font-[family-name:var(--font-mono)] text-[11px] leading-5" style={{ borderColor: '#D6D0C4', background: '#FFFFFF' }} aria-label="Changes">
        {diffLines(proposal.diff).map((line, index) => (
          <span key={index} className="block whitespace-pre-wrap" style={DIFF_LINE_STYLES[line.kind]}>{DIFF_LINE_PREFIX[line.kind]}{line.text}</span>
        ))}
      </pre>
      {isOpen && (
        <>
          <p style={{ color: '#57534E' }}>
            {canApply
              ? 'Nothing has changed yet. Applying creates a new analysis from this edited procedure and uses one of your analysis runs. Your current analysis stays as it is.'
              : 'Nothing has changed. Open this analysis page to apply the change as a new analysis.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {canApply && (
              <button
                type="button"
                onClick={onApply}
                disabled={isBusy}
                className="min-h-11 rounded px-4 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                style={{ background: '#1C3822', color: '#F6F3EB' }}
              >
                {status === 'applying' ? 'Starting…' : status === 'confirmed' ? 'Try again' : 'Apply and re-run analysis'}
              </button>
            )}
            {status !== 'confirmed' && (
              <button
                type="button"
                onClick={onCancel}
                disabled={isBusy}
                className="min-h-11 rounded border px-4 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                style={{ borderColor: '#D6D0C4', background: '#FFFFFF', color: '#1C1917' }}
              >
                Cancel
              </button>
            )}
          </div>
        </>
      )}
      {status === 'applied' && <p role="status" style={{ color: '#166534' }}>Re-running the analysis with this edited procedure.</p>}
      {status === 'cancelled' && <p role="status" style={{ color: '#57534E' }}>Cancelled. Your procedure was not changed.</p>}
      {status === 'superseded' && <p role="status" style={{ color: '#57534E' }}>This proposal is out of date and can no longer be applied.</p>}
      {error && <p role="alert" style={{ color: '#B45309' }}>{error}</p>}
    </section>
  )
}

export type ProposalStatus = 'pending' | 'applying' | 'confirmed' | 'applied' | 'cancelling' | 'cancelled' | 'superseded'

/**
 * One reviewable proposal at a time: a newer one supersedes any still-open older card. The same
 * proposal arriving twice (a deduplicated tool call) is ignored rather than shown twice.
 */
export function withIncomingProposal(entries: ProposalEntry[], proposal: ProcedureProposal): ProposalEntry[] {
  if (entries.some(entry => entry.proposal.proposalId === proposal.proposalId)) return entries
  return [
    ...entries.map((entry): ProposalEntry => (
      entry.status === 'pending' ? { ...entry, status: 'superseded', error: null } : entry
    )),
    { proposal, status: 'pending', error: null },
  ]
}

export interface ProposalEntry {
  proposal: ProcedureProposal
  status: ProposalStatus
  error: string | null
}

/** Server codes meaning this proposal can never be applied (as opposed to a retryable failure). */
const FINAL_PROPOSAL_CODES: Record<string, true> = {
  proposal_closed: true,
  procedure_changed: true,
  proposal_not_found: true,
}

function messageFromBody(body: unknown, fallback: string): string {
  return body && typeof body === 'object' && typeof (body as Record<string, unknown>).error === 'string'
    ? String((body as Record<string, unknown>).error)
    : fallback
}

/**
 * Decides whether the seeded first message goes out now. It is sent once, only into a brand-new
 * empty conversation the scientist has not started typing in; the caller records `consume` so a
 * re-render, a reopened drawer or a "new chat" can never send it again.
 */
export function initialMessageAction(input: {
  initialMessage: string | undefined
  consumed: boolean
  isOpen: boolean
  conversationId: string | null
  disposition: 'created' | 'resumed' | null
  messageCount: number
  draft: string
  isSending: boolean
}): { send: string | null; consume: boolean } {
  const message = input.initialMessage?.trim()
  if (!message || input.consumed || !input.isOpen || !input.conversationId || input.disposition === null) {
    return { send: null, consume: false }
  }
  if (input.disposition === 'resumed' || input.messageCount > 0 || input.draft.trim()) {
    return { send: null, consume: true }
  }
  return input.isSending ? { send: null, consume: false } : { send: message, consume: true }
}

interface TalkAboutThisProps {
  analysisId?: string
  scope: TalkAboutScope
  title: string
  evidenceState: 'sourced' | 'inferred'
  buttonLabel?: string
  className?: string
  buttonStyle?: CSSProperties
  /** Sent automatically, once, when the drawer opens on a new empty conversation. */
  initialMessage?: string
  onRecommendationDecided?: (receipt: RecommendationDecisionReceipt) => void
  /**
   * Called after the server confirms the scientist's Apply. The parent re-runs the edited text as a
   * new analysis; if it throws, its message is shown and the scientist can try again.
   */
  onProcedureProposalApply?: (proposal: ProcedureProposal) => void | Promise<void>
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

export function TalkAboutThis({
  analysisId,
  scope,
  title,
  evidenceState,
  initialMessage,
  onRecommendationDecided,
  onProcedureProposalApply,
  buttonLabel = 'Ask',
  className,
  buttonStyle,
}: TalkAboutThisProps) {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [activities, setActivities] = useState<ChatActivity[]>([])
  const [notifyOnReady, setNotifyOnReady] = useState(false)
  const [decisionReceipt, setDecisionReceipt] = useState<RecommendationDecisionReceipt | null>(null)
  const [evidenceReceipts, setEvidenceReceipts] = useState<EvidenceReceipt[]>([])
  const [decisionReceivedAt, setDecisionReceivedAt] = useState<string | null>(null)
  const [conversationDisposition, setConversationDisposition] = useState<'created' | 'resumed' | null>(null)
  const [verificationNotes, setVerificationNotes] = useState<VerificationNote[]>([])
  const [proposals, setProposals] = useState<ProposalEntry[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null)
  const sendLockedRef = useRef(false)
  const notifiedActionIdsRef = useRef(new Set<string>())
  const proposalsInFlightRef = useRef(new Set<string>())
  const initialMessageConsumedRef = useRef(false)

  const close = () => {
    abortRef.current?.abort()
    setIsOpen(false)
  }

  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    if (!isOpen) return
    focusMessageComposer(messageInputRef)
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen])

  const openConversation = async (newConversation = false) => {
    if (!analysisId || isStarting || isSending) return
    setIsStarting(true)
    setError(null)
    try {
      const response = await fetch('/api/talk-about-this', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisId, scope, newConversation }),
      })
      const body = await response.json().catch(() => null) as unknown
      const conversation = parseOpenConversationResponse(scope, body)
      if (!response.ok || !conversation) {
        throw new Error(messageFromBody(body, 'We could not open the chat. Please try again.'))
      }

      setConversationId(conversation.conversationId)
      setConversationDisposition(conversation.disposition)
      setMessages(conversation.messages)
      setEvidenceReceipts(conversation.evidenceReceipts)
      setDecisionReceipt(conversation.decisionReceipt)
      setDecisionReceivedAt(conversation.decisionReceipt?.receivedAt ?? null)
      setProposals(conversation.proposals.map(proposal => ({ proposal, status: 'pending', error: null })))
      notifiedActionIdsRef.current = new Set(conversation.decisionReceipt ? [conversation.decisionReceipt.actionId] : [])
      if (newConversation) {
        setDraft('')
        setActivities([])
        setError(null)
        setVerificationNotes([])
      }
      focusMessageComposer(messageInputRef)
      setIsOpen(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not open the chat. Please try again.')
    } finally {
      setIsStarting(false)
    }
  }

  const updateProposal = (proposalId: string, change: Partial<Omit<ProposalEntry, 'proposal'>>) => {
    setProposals(current => current.map(entry => (
      entry.proposal.proposalId === proposalId ? { ...entry, ...change } : entry
    )))
  }

  const applyProposal = async (entry: ProposalEntry) => {
    const proposalId = entry.proposal.proposalId
    if (!conversationId || proposalsInFlightRef.current.has(proposalId)) return
    proposalsInFlightRef.current.add(proposalId)
    updateProposal(proposalId, { status: 'applying', error: null })
    // Once the server has confirmed Apply it will not confirm again; a retry only re-runs.
    let confirmed = entry.status === 'confirmed' ? entry.proposal : null
    try {
      if (!confirmed) {
        const response = await fetch(`/api/talk-about-this/${conversationId}/proposals/${proposalId}/apply`, { method: 'POST' })
        const body = await response.json().catch(() => null) as Record<string, unknown> | null
        if (!response.ok || typeof body?.proposedText !== 'string' || !body.proposedText) {
          const code = typeof body?.code === 'string' ? body.code : ''
          updateProposal(proposalId, {
            status: Object.hasOwn(FINAL_PROPOSAL_CODES, code) ? 'superseded' : 'pending',
            error: messageFromBody(body, 'We could not apply that change. Please try again.'),
          })
          return
        }
        confirmed = { ...entry.proposal, proposedText: body.proposedText }
      }
      await onProcedureProposalApply?.(confirmed)
      updateProposal(proposalId, { status: 'applied', error: null })
    } catch (caught) {
      updateProposal(proposalId, {
        status: confirmed ? 'confirmed' : 'pending',
        error: caught instanceof Error && caught.message
          ? caught.message
          : 'We could not start the new analysis. Please try again.',
      })
    } finally {
      proposalsInFlightRef.current.delete(proposalId)
    }
  }

  const cancelProposal = async (entry: ProposalEntry) => {
    const proposalId = entry.proposal.proposalId
    if (!conversationId || proposalsInFlightRef.current.has(proposalId)) return
    proposalsInFlightRef.current.add(proposalId)
    updateProposal(proposalId, { status: 'cancelling', error: null })
    try {
      const response = await fetch(`/api/talk-about-this/${conversationId}/proposals/${proposalId}/cancel`, { method: 'POST' })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as unknown
        throw new Error(messageFromBody(body, 'We could not cancel that proposal. Please try again.'))
      }
      updateProposal(proposalId, { status: 'cancelled' })
    } catch (caught) {
      updateProposal(proposalId, {
        status: 'pending',
        error: caught instanceof Error ? caught.message : 'We could not cancel that proposal. Please try again.',
      })
    } finally {
      proposalsInFlightRef.current.delete(proposalId)
    }
  }

  const sendContent = async (content: string, options: { clearDraft: boolean }) => {
    if (!conversationId || !content || isSending || sendLockedRef.current) return
    sendLockedRef.current = true

    const createdAt = new Date().toISOString()
    if (options.clearDraft) setDraft('')
    setActivities([])
    setError(null)
    setIsSending(true)
    setMessages(current => [...current, {
      id: `local-user-${createdAt}`,
      role: 'user',
      content,
      citations: [],
      status: 'complete',
      ttftMs: null,
      createdAt,
    }, {
      id: `local-assistant-${createdAt}`,
      role: 'assistant',
      content: '',
      citations: [],
      status: 'streaming',
      ttftMs: null,
      createdAt,
    }])

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
        const body = await response.json().catch(() => null) as unknown
        throw new Error(messageFromBody(body, 'We could not send that message. Please try again.'))
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
          const verificationNote = verificationNoteFromEvent(parsed.event, parsed.data)
          if (verificationNote) {
            setVerificationNotes(current => [...current, verificationNote])
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
          if (parsed.event === 'recommendation-decided') {
            const decision = applyRecommendationDecidedEvent(scope, parsed.data, notifiedActionIdsRef.current)
            if (decision.receipt) {
              setDecisionReceipt(decision.receipt)
              if (decision.shouldNotifyParent) {
                notifiedActionIdsRef.current.add(decision.receipt.actionId)
                setDecisionReceivedAt(new Date().toISOString())
                onRecommendationDecided?.(decision.receipt)
              }
            }
          }
          if (parsed.event === 'procedure-proposal') {
            const proposal = parseProcedureProposal(parsed.data)
            if (proposal) setProposals(current => withIncomingProposal(current, proposal))
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
        setError(caught instanceof Error ? caught.message : 'We could not send that message. Please try again.')
      }
    } finally {
      abortRef.current = null
      sendLockedRef.current = false
      setIsSending(false)
    }
  }

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = draft.trim()
    if (isNewConversationCommand(content)) {
      await openConversation(true)
      return
    }
    await sendContent(content, { clearDraft: true })
  }

  const initialAction = initialMessageAction({
    initialMessage,
    consumed: initialMessageConsumedRef.current,
    isOpen,
    conversationId,
    disposition: conversationDisposition,
    messageCount: messages.length,
    draft,
    isSending,
  })
  useEffect(() => {
    // The ref is checked again here so a repeated effect run (Strict Mode, re-render) cannot send twice.
    if (initialMessageConsumedRef.current || !initialAction.consume) return
    initialMessageConsumedRef.current = true
    if (initialAction.send) void sendContent(initialAction.send, { clearDraft: false })
  }, [initialAction.consume, initialAction.send])

  const groupedNotes = groupVerificationNotes(verificationNotes)

  return (
    <>
      <button
        type="button"
        onClick={() => void openConversation()}
        disabled={!analysisId || isStarting}
        className={className ?? 'text-xs px-3 py-1.5 rounded border font-bold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50'}
        style={buttonStyle ?? { color: '#1C3822', borderColor: '#2D4A3A', background: '#F6F3EB' }}
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
                  <p aria-live="polite" className="mt-1 text-xs font-bold uppercase tracking-wider" style={{ color: '#2D4A3A' }}>
                    {conversationDisposition === 'created'
                      ? 'New scoped chat'
                      : conversationDisposition === 'resumed'
                        ? 'Resumed chat'
                        : ''}
                  </p>
                  <h2 className="mt-1 text-lg font-bold font-[family-name:var(--font-serif)]" style={{ color: '#1C1917' }}>{title}</h2>
                  <p className="mt-1 text-xs" style={{ color: '#57534E' }}>
                    {evidenceState === 'sourced' ? 'Direct evidence is included in this discussion.' : 'Model-inferred — no direct evidence located.'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => void openConversation(true)} disabled={isStarting || isSending} className="text-sm font-bold disabled:opacity-50" style={{ color: '#1C3822' }}>New chat</button>
                  <button type="button" onClick={close} className="text-sm font-bold" style={{ color: '#57534E' }}>Close</button>
                </div>
              </div>
              <DiscussionScopeInstruction scope={scope} />
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
              {decisionReceipt && <DecisionReceiptCard receipt={decisionReceipt} receivedAt={decisionReceivedAt} />}
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
              {proposals.map(entry => (
                <ProposalCard
                  key={entry.proposal.proposalId}
                  proposal={entry.proposal}
                  status={entry.status}
                  error={entry.error}
                  canApply={onProcedureProposalApply !== undefined}
                  onApply={() => void applyProposal(entry)}
                  onCancel={() => void cancelProposal(entry)}
                />
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
              {groupedNotes.length > 0 && (
                <details className="rounded-lg border p-3 text-xs" aria-label="Verification notes" style={{ borderColor: '#D6D0C4', background: '#F6F3EB', color: '#57534E' }}>
                  <summary>Verification notes ({groupedNotes.length})</summary>
                  {groupedNotes.map(note => (
                    <p key={`${note.source}:${note.reasonCode}`} className="mt-1">
                      {note.text}{note.count > 1 ? ` (${note.count} lookups)` : ''}
                    </p>
                  ))}
                </details>
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
              <textarea ref={messageInputRef} id="talk-about-this-message" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => handleComposerKeyDown(event, isSending, draft)} maxLength={4000} rows={3} placeholder={scope.kind === 'recommendation' ? 'Ask about this recommendation…' : scope.kind === 'chemistry-clarification' ? 'Describe the material, or ask what to change…' : 'Ask about this analysis…'} className="w-full rounded border p-3 text-sm" style={{ borderColor: '#D6D0C4', color: '#1C1917' }} disabled={isSending} />
              <DecisionActions scope={scope} disabled={isSending || !conversationId} onDecide={phrase => void sendContent(phrase, { clearDraft: false })} />
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
