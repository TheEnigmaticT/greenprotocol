import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DecisionActions,
  DecisionReceiptCard,
  ProposalCard,
  activityForEvent,
  applyRecommendationDecidedEvent,
  diffLines,
  initialMessageAction,
  parseOpenConversationResponse,
  parsePersistedRecommendationDecisionReceipt,
  parseRecommendationDecidedEvent,
  withIncomingProposal,
} from '@/components/TalkAboutThis'
import { applyRecommendationDecision, parseRecommendationDecisionReceipt } from '@/lib/talk-about-this/decisions'
import { parseProcedureProposal, type ProcedureProposal } from '@/lib/talk-about-this/procedure-proposal'
import type { TalkAboutScope } from '@/lib/talk-about-this/scope'
import type { AnalysisResult, Recommendation } from '@/lib/types'

const stableScope: TalkAboutScope = { kind: 'recommendation', recommendationId: 'rec-1' }
const readOnlyScope: TalkAboutScope = { kind: 'recommendation', recommendationIndex: 0, readOnly: true }

const receiptData = {
  recommendationId: 'rec-1',
  decision: 'rejected',
  label: 'Replace DMF with Cyrene',
  alreadyDecided: false,
  actionId: 'action-1',
  revisionNumber: 4,
}

const proposal: ProcedureProposal = {
  proposalId: 'proposal-1',
  summary: 'Swap DMF for Cyrene',
  diff: '@@ -1,3 +1,3 @@\n 1. Dissolve the amine.\n-2. Add 20 mL DMF.\n+2. Add 20 mL Cyrene.\n 3. Stir.',
  proposedText: '1. Dissolve the amine.\n2. Add 20 mL Cyrene.\n3. Stir.',
  baseRevisionNumber: 2,
}

describe('recommendation-decided events', () => {
  it('accepts approve and reject receipts for the current stable recommendation', () => {
    expect(parseRecommendationDecidedEvent(stableScope, receiptData)).toEqual(receiptData)
    expect(parseRecommendationDecidedEvent(stableScope, { ...receiptData, decision: 'approved' })).toMatchObject({ decision: 'approved' })
  })

  it.each([
    ['another recommendation', stableScope, { ...receiptData, recommendationId: 'rec-2' }],
    ['a principle scope', { kind: 'principle', principleNumber: 5 } as TalkAboutScope, receiptData],
    ['a read-only scope', readOnlyScope, receiptData],
    ['an unknown decision', stableScope, { ...receiptData, decision: 'maybe' }],
    ['the old approval-only shape', stableScope, { recommendationId: 'rec-1', label: 'x', alreadyAccepted: false, actionId: 'a', revisionNumber: 4 }],
    ['an empty label', stableScope, { ...receiptData, label: ' ' }],
    ['a fractional revision', stableScope, { ...receiptData, revisionNumber: 4.5 }],
    ['revision zero', stableScope, { ...receiptData, revisionNumber: 0 }],
    ['a missing action id', stableScope, { ...receiptData, actionId: '' }],
  ])('ignores a receipt for %s', (_name, scope, data) => {
    expect(parseRecommendationDecidedEvent(scope, data)).toBeNull()
  })

  it('notifies the parent once per action id, including after a reopened chat hydrated that receipt', () => {
    const fresh = applyRecommendationDecidedEvent(stableScope, receiptData, new Set())
    const replay = applyRecommendationDecidedEvent(stableScope, receiptData, new Set(['action-1']))
    const nextDecision = applyRecommendationDecidedEvent(stableScope, { ...receiptData, decision: 'approved', actionId: 'action-2' }, new Set(['action-1']))

    expect(fresh.shouldNotifyParent).toBe(true)
    expect(replay.receipt).toEqual(receiptData)
    expect(replay.shouldNotifyParent).toBe(false)
    expect(nextDecision.shouldNotifyParent).toBe(true)
  })

  it('hydrates a persisted receipt with its completion time', () => {
    expect(parsePersistedRecommendationDecisionReceipt(stableScope, { ...receiptData, receivedAt: '2026-10-26T00:00:00.000Z' }))
      .toEqual({ ...receiptData, receivedAt: '2026-10-26T00:00:00.000Z' })
    expect(parsePersistedRecommendationDecisionReceipt(stableScope, receiptData)).toBeNull()
  })
})

describe('applyRecommendationDecision', () => {
  function recommendation(id: string, isAccepted?: boolean): Recommendation {
    return {
      id,
      stepNumber: 1,
      principleNumbers: [5],
      principleNames: ['Safer Solvents'],
      severity: 'high',
      original: { chemical: 'DMF', issue: 'x' },
      alternative: { chemical: 'Cyrene', rationale: 'x', yieldImpact: 'x', caveats: 'x', evidenceBasis: 'x' },
      confidenceLevel: 'medium',
      ...(isAccepted === undefined ? {} : { isAccepted }),
    }
  }
  const analysis = { protocolTitle: 't', steps: [], recommendations: [recommendation('rec-1'), recommendation('rec-2', true)] } as unknown as AnalysisResult

  it('walks approve, reject, approve on the matching recommendation only', () => {
    const approved = applyRecommendationDecision(analysis, { recommendationId: 'rec-1', decision: 'approved' })
    const rejected = applyRecommendationDecision(approved, { recommendationId: 'rec-1', decision: 'rejected' })
    const approvedAgain = applyRecommendationDecision(rejected, { recommendationId: 'rec-1', decision: 'approved' })

    expect(approved.recommendations[0].isAccepted).toBe(true)
    expect(rejected.recommendations[0].isAccepted).toBe(false)
    expect(approvedAgain.recommendations[0].isAccepted).toBe(true)
    expect(rejected.recommendations[1].isAccepted).toBe(true)
  })

  it('does not mutate its input and ignores an unknown recommendation id', () => {
    const result = applyRecommendationDecision(analysis, { recommendationId: 'nope', decision: 'rejected' })

    expect(result.recommendations).toEqual(analysis.recommendations)
    expect(analysis.recommendations[0].isAccepted).toBeUndefined()
  })

  it('validates receipts for pages the same way the chat does', () => {
    expect(parseRecommendationDecisionReceipt(receiptData)).toEqual(receiptData)
    expect(parseRecommendationDecisionReceipt({ ...receiptData, decision: 'approve' })).toBeNull()
  })
})

describe('DecisionActions', () => {
  it('renders Approve this and Reject this for a stable recommendation scope', () => {
    const markup = renderToStaticMarkup(createElement(DecisionActions, { scope: stableScope, disabled: false, onDecide: () => undefined }))

    expect(markup).toContain('Approve this')
    expect(markup).toContain('Reject this')
    expect(markup).toContain('min-h-11')
  })

  it.each([
    ['read-only index', readOnlyScope],
    ['principle', { kind: 'principle', principleNumber: 5 } as TalkAboutScope],
    ['no-recommendations', { kind: 'no-recommendations' } as TalkAboutScope],
    ['clarification', { kind: 'chemistry-clarification', issue: 'rescore-failed', chemicals: [] } as TalkAboutScope],
  ])('renders nothing for the %s scope', (_name, scope) => {
    expect(renderToStaticMarkup(createElement(DecisionActions, { scope, disabled: false, onDecide: () => undefined }))).toBe('')
  })

  it('disables both buttons while a response is in flight', () => {
    const markup = renderToStaticMarkup(createElement(DecisionActions, { scope: stableScope, disabled: true, onDecide: () => undefined }))

    expect(markup.match(/disabled=""/g)).toHaveLength(2)
  })
})

describe('DecisionReceiptCard', () => {
  it('states the latest decision plainly without internal identifiers', () => {
    const rejected = renderToStaticMarkup(createElement(DecisionReceiptCard, { receipt: receiptData as never, receivedAt: null }))
    const already = renderToStaticMarkup(createElement(DecisionReceiptCard, { receipt: { ...receiptData, decision: 'approved', alreadyDecided: true } as never, receivedAt: null }))

    expect(rejected).toContain('Replace DMF with Cyrene has been rejected.')
    expect(already).toContain('was already approved.')
    expect(rejected).not.toContain('action-1')
    expect(rejected).not.toContain('revision')
  })
})

describe('procedure proposals on the client', () => {
  it('parses a complete proposal and rejects incomplete ones', () => {
    expect(parseProcedureProposal(proposal)).toEqual(proposal)
    expect(parseProcedureProposal({ ...proposal, diff: '' })).toBeNull()
    expect(parseProcedureProposal({ ...proposal, baseRevisionNumber: 0 })).toBeNull()
    expect(parseProcedureProposal({ ...proposal, proposedText: undefined })).toBeNull()
    expect(parseProcedureProposal(null)).toBeNull()
  })

  it('classifies diff lines for display', () => {
    expect(diffLines(proposal.diff).map(line => line.kind)).toEqual(['hunk', 'context', 'remove', 'add', 'context'])
    expect(diffLines('+x')[0]).toEqual({ kind: 'add', text: 'x' })
  })

  const render = (props: Partial<Parameters<typeof ProposalCard>[0]> = {}) => renderToStaticMarkup(createElement(ProposalCard, {
    proposal,
    status: 'pending',
    error: null,
    canApply: true,
    onApply: () => undefined,
    onCancel: () => undefined,
    ...props,
  }))

  it('shows the server diff and the exact apply and cancel actions with the new-analysis and run-cost copy', () => {
    const markup = render()

    expect(markup).toContain('Swap DMF for Cyrene')
    expect(markup).toContain('2. Add 20 mL DMF.')
    expect(markup).toContain('2. Add 20 mL Cyrene.')
    expect(markup).toContain('Apply and re-run analysis')
    expect(markup).toContain('Cancel')
    expect(markup).toContain('creates a new analysis')
    expect(markup).toContain('uses one of your analysis runs')
    expect(markup).toContain('Your current analysis stays as it is')
    expect(markup).toContain('Nothing has changed yet')
  })

  it('offers no Apply when the page cannot re-run, and says so', () => {
    const markup = render({ canApply: false })

    expect(markup).not.toContain('Apply and re-run analysis')
    expect(markup).toContain('Nothing has changed')
  })

  it('disables both buttons while applying and offers a retry once the server confirmed but the re-run failed', () => {
    expect(render({ status: 'applying' }).match(/disabled=""/g)).toHaveLength(2)
    const retry = render({ status: 'confirmed', error: 'We could not start the new analysis. Please try again.' })

    expect(retry).toContain('Try again')
    expect(retry).not.toContain('Cancel')
    expect(retry).toContain('role="alert"')
  })

  it.each([
    ['applied', 'Re-running the analysis'],
    ['cancelled', 'Your procedure was not changed'],
    ['superseded', 'out of date'],
  ] as const)('shows a %s proposal as read-only history', (status, wording) => {
    const markup = render({ status })

    expect(markup).toContain(wording)
    expect(markup).not.toContain('Apply and re-run analysis')
  })
})

describe('withIncomingProposal', () => {
  const newer = { ...proposal, proposalId: 'proposal-2', summary: 'Second try' }

  it('supersedes a still-open older proposal and keeps one pending card', () => {
    const entries = withIncomingProposal(withIncomingProposal([], proposal), newer)

    expect(entries.map(entry => [entry.proposal.proposalId, entry.status])).toEqual([
      ['proposal-1', 'superseded'],
      ['proposal-2', 'pending'],
    ])
  })

  it('ignores the same proposal arriving twice, as happens when identical tool calls are deduplicated', () => {
    const once = withIncomingProposal([], proposal)

    expect(withIncomingProposal(once, proposal)).toBe(once)
  })

  it('leaves proposals the scientist already applied or cancelled untouched', () => {
    const entries = withIncomingProposal([
      { proposal, status: 'cancelled', error: null },
      { proposal: { ...proposal, proposalId: 'proposal-0' }, status: 'confirmed', error: null },
    ], newer)

    expect(entries.map(entry => entry.status)).toEqual(['cancelled', 'confirmed', 'pending'])
  })
})

describe('open-conversation hydration with the new contract', () => {
  const body = {
    conversationId: 'conversation-1',
    disposition: 'resumed',
    scope: stableScope,
    contextHash: 'a'.repeat(64),
    noDirectEvidence: false,
    messages: [],
    evidenceReceipts: [],
    decisionReceipt: null,
    proposals: [proposal],
  }

  it('restores pending proposals', () => {
    expect(parseOpenConversationResponse(stableScope, body)).toMatchObject({ decisionReceipt: null, proposals: [proposal] })
  })

  it('rejects a payload with a malformed proposal or a missing proposals list rather than dropping it silently', () => {
    expect(parseOpenConversationResponse(stableScope, { ...body, proposals: [{ ...proposal, diff: '' }] })).toBeNull()
    expect(parseOpenConversationResponse(stableScope, { ...body, proposals: undefined })).toBeNull()
  })

  it('matches clarification scopes by content', () => {
    const clarification: TalkAboutScope = { kind: 'chemistry-clarification', issue: 'unresolved-compound', chemicals: ['brine'] }

    expect(parseOpenConversationResponse(clarification, { ...body, scope: clarification, proposals: [] })).not.toBeNull()
    expect(parseOpenConversationResponse(clarification, { ...body, scope: { ...clarification, chemicals: ['water'] }, proposals: [] })).toBeNull()
  })
})

describe('initial message', () => {
  const ready = {
    initialMessage: 'What is reagent X-77?',
    consumed: false,
    isOpen: true,
    conversationId: 'conversation-1',
    disposition: 'created' as const,
    messageCount: 0,
    draft: '',
    isSending: false,
  }

  it('sends exactly once into a new empty conversation', () => {
    const first = initialMessageAction(ready)
    const afterConsume = initialMessageAction({ ...ready, consumed: first.consume })

    expect(first).toEqual({ send: 'What is reagent X-77?', consume: true })
    expect(afterConsume).toEqual({ send: null, consume: false })
  })

  it('never sends again when the drawer is reopened, the chat restarts, or the reply makes the count nonzero', () => {
    expect(initialMessageAction({ ...ready, consumed: true, messageCount: 0 }).send).toBeNull()
    expect(initialMessageAction({ ...ready, consumed: true, messageCount: 2 }).send).toBeNull()
  })

  it('never sends into a resumed conversation, and spends the message so a later empty state cannot send it', () => {
    expect(initialMessageAction({ ...ready, disposition: 'resumed' })).toEqual({ send: null, consume: true })
  })

  it('never sends into a conversation that already has messages', () => {
    expect(initialMessageAction({ ...ready, messageCount: 1 })).toEqual({ send: null, consume: true })
  })

  it('does not override a message the scientist already started typing', () => {
    expect(initialMessageAction({ ...ready, draft: ' my own question ' })).toEqual({ send: null, consume: true })
  })

  it('waits while the drawer is closed, the conversation is not ready, or a send is in flight', () => {
    expect(initialMessageAction({ ...ready, isOpen: false })).toEqual({ send: null, consume: false })
    expect(initialMessageAction({ ...ready, conversationId: null })).toEqual({ send: null, consume: false })
    expect(initialMessageAction({ ...ready, disposition: null })).toEqual({ send: null, consume: false })
    expect(initialMessageAction({ ...ready, isSending: true })).toEqual({ send: null, consume: false })
  })

  it('does nothing without a message', () => {
    expect(initialMessageAction({ ...ready, initialMessage: undefined })).toEqual({ send: null, consume: false })
    expect(initialMessageAction({ ...ready, initialMessage: '   ' })).toEqual({ send: null, consume: false })
  })
})

describe('proposal activity wording', () => {
  it('describes the tool in plain language instead of its internal name', () => {
    const labels = (['tool-start', 'tool-complete', 'tool-failed'] as const).map(event =>
      activityForEvent(event, { callId: 'c', tool: 'propose_procedure_edit', status: 'ok' })?.label)

    expect(labels).toEqual([
      'Preparing a proposed change to your procedure',
      'Proposed change ready for your review',
      'The proposed change could not be matched to your procedure',
    ])
    expect(labels.join(' ')).not.toContain('propose_procedure_edit')
  })

  it('shows no activity row for the proposal event itself', () => {
    expect(activityForEvent('procedure-proposal', { ...proposal })).toBeNull()
  })
})
