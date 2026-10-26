import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RepositoryModule from '@/lib/talk-about-this/repository'

const repository = vi.hoisted(() => ({
  createMessage: vi.fn(),
  listConversationMessages: vi.fn(),
  loadOwnedAnalysis: vi.fn(),
  loadOwnedConversation: vi.fn(),
}))
const runScopedToolChat = vi.hoisted(() => vi.fn())
const createClient = vi.hoisted(() => vi.fn())
const createConfiguredChatProvider = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/talk-about-this/agent', () => ({ runScopedToolChat }))
vi.mock('@/lib/talk-about-this/chat-provider', () => ({ createConfiguredChatProvider }))
vi.mock('@/lib/talk-about-this/repository', async importOriginal => ({
  ...(await importOriginal<typeof RepositoryModule>()),
  ...repository,
}))

import { POST as postMessage } from '@/app/api/talk-about-this/[conversationId]/messages/route'
import { POST as applyProposal } from '@/app/api/talk-about-this/[conversationId]/proposals/[proposalId]/apply/route'
import { POST as cancelProposal } from '@/app/api/talk-about-this/[conversationId]/proposals/[proposalId]/cancel/route'
import { parseSseEvent } from './sse'

const rpc = vi.fn()

function authenticated(user: { id: string } | null = { id: 'user-1' }) {
  createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: user ? null : new Error('no session') }) },
    rpc,
  })
}

function conversationRow(scope: Record<string, unknown>, snapshotText = 'Use DMF.') {
  return {
    id: 'conversation-1',
    analysis_id: 'analysis-1',
    status: 'active',
    scope,
    context_snapshot: { citations: [], protocolText: snapshotText, scope },
  }
}

function messageRequest(content: string) {
  return new Request('http://localhost/api/talk-about-this/conversation-1/messages', {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
}

const messageParams = { params: Promise.resolve({ conversationId: 'conversation-1' }) }

function rpcReceipt(overrides: Record<string, unknown> = {}) {
  return {
    data: [{
      action_id: 'action-1',
      recommendation_id: 'rec-1',
      label: 'Use ethanol',
      already_accepted: false,
      revision_number: 2,
      ...overrides,
    }],
    error: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  authenticated()
  repository.createMessage.mockResolvedValue({ id: 'message' })
  repository.listConversationMessages.mockResolvedValue([])
  repository.loadOwnedConversation.mockResolvedValue(conversationRow({ kind: 'recommendation', recommendationId: 'rec-1' }))
  createConfiguredChatProvider.mockReturnValue({})
})

describe('recommendation decisions from chat', () => {
  it.each([
    ['approve this', 'approve_scoped_recommendation', 'approved', 'approve_recommendation'],
    ['Reject this.', 'reject_scoped_recommendation', 'rejected', 'reject_recommendation'],
    ['dismiss this', 'reject_scoped_recommendation', 'rejected', 'reject_recommendation'],
  ])('handles %j on the server without ever calling the model', async (content, rpcName, decision, action) => {
    rpc.mockResolvedValue(rpcReceipt())

    const response = await postMessage(messageRequest(content), messageParams)
    const events = (await response.text()).trim().split('\n\n').map(parseSseEvent)

    expect(rpc).toHaveBeenCalledWith(rpcName, { p_conversation_id: 'conversation-1' })
    expect(runScopedToolChat).not.toHaveBeenCalled()
    expect(createConfiguredChatProvider).not.toHaveBeenCalled()
    expect(events.map(event => event.event)).toEqual(['conversation', 'recommendation-decided', 'done'])
    expect(events[1].data).toEqual({
      actionId: 'action-1',
      recommendationId: 'rec-1',
      decision,
      label: 'Use ethanol',
      alreadyDecided: false,
      revisionNumber: 2,
    })
    expect(events[2].data).toMatchObject({ action, status: 'complete' })
    expect(repository.createMessage).toHaveBeenCalledTimes(2)
  })

  it('sends conversational text that merely mentions rejecting to the model, never the RPC', async () => {
    runScopedToolChat.mockResolvedValue({ answer: 'ok', citations: [], evidence: [], telemetry: {}, diagnosticPersistence: Promise.resolve() })

    await (await postMessage(messageRequest('Should I reject this?'), messageParams)).text()

    expect(rpc).not.toHaveBeenCalled()
    expect(runScopedToolChat).toHaveBeenCalledTimes(1)
  })

  it('supports approve, reject, approve in one conversation with a distinct receipt each time', async () => {
    rpc
      .mockResolvedValueOnce(rpcReceipt({ action_id: 'a-1', revision_number: 2 }))
      .mockResolvedValueOnce(rpcReceipt({ action_id: 'a-2', revision_number: 3 }))
      .mockResolvedValueOnce(rpcReceipt({ action_id: 'a-3', revision_number: 4 }))

    const decisions = []
    for (const phrase of ['approve this', 'reject this', 'approve this']) {
      const events = (await (await postMessage(messageRequest(phrase), messageParams)).text()).trim().split('\n\n').map(parseSseEvent)
      decisions.push(events.find(event => event.event === 'recommendation-decided')!.data)
    }

    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['approve_scoped_recommendation', 'reject_scoped_recommendation', 'approve_scoped_recommendation'])
    expect(decisions.map(data => [data.decision, data.actionId, data.revisionNumber])).toEqual([
      ['approved', 'a-1', 2],
      ['rejected', 'a-2', 3],
      ['approved', 'a-3', 4],
    ])
  })

  it('says a repeat decision changed nothing', async () => {
    rpc.mockResolvedValue(rpcReceipt({ already_accepted: true }))

    await (await postMessage(messageRequest('reject this'), messageParams)).text()

    expect(repository.createMessage).toHaveBeenLastCalledWith(expect.anything(), 'user-1', 'conversation-1', expect.objectContaining({
      role: 'assistant',
      content: 'Use ethanol was already rejected. Nothing changed.',
    }))
  })

  it.each([
    ['P0002', 409, 'no longer part of the saved analysis'],
    ['40001', 409, 'changed while you were deciding'],
    ['22023', 400, 'not about a single recommendation'],
  ])('turns database failure %s into plain wording and persists no transcript', async (code, status, wording) => {
    rpc.mockResolvedValue({ data: null, error: { message: 'raw db text: gpc_talk_actions', code } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await postMessage(messageRequest('approve this'), messageParams)
    const body = await response.json() as { error: string; code: string }

    expect(response.status).toBe(status)
    expect(body.error).toContain(wording)
    expect(JSON.stringify(body)).not.toContain('gpc_')
    expect(repository.createMessage).not.toHaveBeenCalled()
  })

  it('refuses a read-only scope: the RPC rejects it and nothing is claimed', async () => {
    repository.loadOwnedConversation.mockResolvedValue(conversationRow({ kind: 'recommendation', recommendationIndex: 0, readOnly: true }))
    rpc.mockResolvedValue({ data: null, error: { message: 'x', code: '22023' } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await postMessage(messageRequest('reject this'), messageParams)

    expect(response.status).toBe(400)
    expect(repository.createMessage).not.toHaveBeenCalled()
  })

  it('requires a signed-in user before any decision', async () => {
    authenticated(null)

    const response = await postMessage(messageRequest('approve this'), messageParams)

    expect(response.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('procedure proposals in the message route', () => {
  const principleScope = { kind: 'principle', principleNumber: 5 }

  function runChatWith(onRun: (input: { onEvent: (event: string, data: Record<string, unknown>) => void; fullProcedureText?: string }) => void) {
    runScopedToolChat.mockImplementation(async input => {
      onRun(input)
      return { answer: 'Here is a proposal.', citations: [], evidence: [], telemetry: {}, diagnosticPersistence: Promise.resolve() }
    })
  }

  it('forwards the proposal event to the client unchanged', async () => {
    repository.loadOwnedConversation.mockResolvedValue(conversationRow(principleScope))
    const proposal = { proposalId: 'p-1', summary: 'Swap', diff: '@@ -1 +1 @@\n-a\n+b', proposedText: 'b text here and more', baseRevisionNumber: 2 }
    runChatWith(input => input.onEvent('procedure-proposal', proposal))

    const events = (await (await postMessage(messageRequest('Swap DMF please'), messageParams)).text()).trim().split('\n\n').map(parseSseEvent)

    expect(events.find(event => event.event === 'procedure-proposal')?.data).toEqual(proposal)
  })

  it('gives the model the complete saved procedure only when the snapshot was truncated', async () => {
    const full = `${'step. '.repeat(3_000)}END-OF-PROCEDURE`
    repository.loadOwnedAnalysis.mockResolvedValue({ id: 'analysis-1', protocol_text: full, revision_number: 1 })
    let received: string | undefined
    runChatWith(input => { received = input.fullProcedureText })

    repository.loadOwnedConversation.mockResolvedValue(conversationRow(principleScope, `${'step. '.repeat(2_000)}\n\n[Protocol truncated for chat context]`))
    await (await postMessage(messageRequest('Swap DMF please'), messageParams)).text()
    expect(received).toBe(full)
    expect(repository.loadOwnedAnalysis).toHaveBeenCalledWith(expect.anything(), 'user-1', 'analysis-1')

    received = 'unset'
    repository.loadOwnedAnalysis.mockClear()
    repository.loadOwnedConversation.mockResolvedValue(conversationRow(principleScope, 'Short procedure.'))
    await (await postMessage(messageRequest('Swap DMF please'), messageParams)).text()
    expect(received).toBeUndefined()
    expect(repository.loadOwnedAnalysis).not.toHaveBeenCalled()
  })

  it('never loads the procedure for a read-only scope', async () => {
    repository.loadOwnedConversation.mockResolvedValue(conversationRow(
      { kind: 'recommendation', recommendationIndex: 0, readOnly: true },
      `${'step. '.repeat(2_000)}\n\n[Protocol truncated for chat context]`,
    ))
    runChatWith(() => undefined)

    await (await postMessage(messageRequest('hello'), messageParams)).text()

    expect(repository.loadOwnedAnalysis).not.toHaveBeenCalled()
  })
})

describe('proposal apply and cancel routes', () => {
  const params = { params: Promise.resolve({ conversationId: 'conversation-1', proposalId: 'proposal-1' }) }
  const request = () => new Request('http://localhost/x', { method: 'POST' })

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('returns the confirmed text without touching the analysis or running one', async () => {
    rpc.mockResolvedValue({ data: [{ outcome: 'applied', proposal_id: 'proposal-1', summary: 'Swap', proposed_text: 'Edited procedure text', base_revision_number: 2 }], error: null })

    const response = await applyProposal(request(), params)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ proposalId: 'proposal-1', summary: 'Swap', proposedText: 'Edited procedure text' })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('apply_talk_procedure_proposal', { p_conversation_id: 'conversation-1', p_proposal_id: 'proposal-1' })
    expect(repository.loadOwnedAnalysis).not.toHaveBeenCalled()
  })

  it('answers 409 when the saved procedure no longer matches the proposal base', async () => {
    rpc.mockResolvedValue({ data: [{ outcome: 'stale', proposal_id: 'proposal-1', summary: 'Swap', proposed_text: null, base_revision_number: 2 }], error: null })

    const response = await applyProposal(request(), params)
    const body = await response.json() as { error: string; code: string; proposedText?: string }

    expect(response.status).toBe(409)
    expect(body.code).toBe('procedure_changed')
    expect(body.error).toContain('out of date')
    expect(body.proposedText).toBeUndefined()
  })

  it.each([
    ['P0002', 404, 'proposal_not_found'],
    ['55000', 409, 'proposal_closed'],
    ['22P02', 404, 'proposal_not_found'],
    ['42501', 401, 'sign_in_required'],
  ])('maps database state %s to a friendly %i', async (sqlState, status, code) => {
    rpc.mockResolvedValue({ data: null, error: { message: 'raw: gpc_talk_proposals', code: sqlState } })

    const response = await applyProposal(request(), params)
    const body = await response.json() as { error: string; code: string }

    expect(response.status).toBe(status)
    expect(body.code).toBe(code)
    expect(body.error).not.toContain('gpc_')
  })

  it('does not reveal whether another user’s proposal exists: a wrong owner looks like not found', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Procedure proposal not found', code: 'P0002' } })

    expect((await applyProposal(request(), params)).status).toBe(404)
  })

  it('requires a signed-in user', async () => {
    authenticated(null)

    expect((await applyProposal(request(), params)).status).toBe(401)
    expect((await cancelProposal(request(), params)).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('cancels through the cancel RPC only', async () => {
    rpc.mockResolvedValue({ data: 'cancelled', error: null })

    const response = await cancelProposal(request(), params)

    expect(await response.json()).toEqual({ proposalId: 'proposal-1', status: 'cancelled' })
    expect(rpc).toHaveBeenCalledWith('cancel_talk_procedure_proposal', { p_conversation_id: 'conversation-1', p_proposal_id: 'proposal-1' })
  })

  it('refuses to cancel a proposal that was already applied', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'x', code: '55000' } })

    expect((await cancelProposal(request(), params)).status).toBe(409)
  })
})
