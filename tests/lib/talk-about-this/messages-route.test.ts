import { describe, expect, it, vi } from 'vitest'
import type * as TalkAboutContextModule from '@/lib/talk-about-this/context'

const repository = vi.hoisted(() => ({
  createConversation: vi.fn(),
  createMessage: vi.fn(),
  createToolRun: vi.fn(),
  assistantMessageCitations: vi.fn(() => []),
  evidenceReceiptsForUi: vi.fn(),
  findOwnedConversationByContextHash: vi.fn(),
  conversationHistoryForUi: vi.fn(),
  linkToolRunsToAssistantMessage: vi.fn(),
  listConversationMessages: vi.fn(),
  loadOwnedAnalysis: vi.fn(),
  loadOwnedConversation: vi.fn(),
  loadOwnedRecommendationApprovalReceipt: vi.fn(),
}))
const runScopedToolChat = vi.hoisted(() => vi.fn())
const createClient = vi.hoisted(() => vi.fn())
const createAdminClient = vi.hoisted(() => vi.fn())
const createConfiguredChatProvider = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/talk-about-this/agent', () => ({ runScopedToolChat }))
vi.mock('@/lib/talk-about-this/chat-provider', () => ({ createConfiguredChatProvider }))
vi.mock('@/lib/talk-about-this/repository', () => repository)
vi.mock('@/lib/talk-about-this/context', async (importOriginal) => ({
  ...(await importOriginal<typeof TalkAboutContextModule>()),
  buildTalkAboutContext: vi.fn(() => ({
    contextHash: 'context-hash',
    noDirectEvidence: false,
  })),
}))

import { POST } from '@/app/api/talk-about-this/route'
import { evidenceFromEvent } from '@/components/TalkAboutThis'

describe('open scoped conversation route', () => {
  const scope = { kind: 'principle', principleNumber: 1 }
  const existingConversation = {
    id: 'existing-conversation',
    scope,
    context_hash: 'context-hash',
  }

  function configureAuthenticatedRequest() {
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
    })
    repository.loadOwnedAnalysis.mockResolvedValue({
      id: 'analysis-1',
      protocol_text: 'Example protocol',
      analysis_result: {},
    })
    repository.listConversationMessages.mockResolvedValue([{
      id: 'message-1',
      role: 'user',
      content: 'Is this significant?',
      citations: [],
      status: 'complete',
      ttft_ms: null,
      created_at: '2026-08-12T00:00:00.000Z',
    }])
    repository.conversationHistoryForUi.mockReturnValue([{
      id: 'message-1',
      role: 'user',
      content: 'Is this significant?',
      citations: [],
      status: 'complete',
      ttftMs: null,
      createdAt: '2026-08-12T00:00:00.000Z',
    }])
    repository.evidenceReceiptsForUi.mockReturnValue([])
    repository.loadOwnedRecommendationApprovalReceipt.mockResolvedValue(null)
  }

  it('resumes an owned matching conversation with its persisted history', async () => {
    vi.clearAllMocks()
    configureAuthenticatedRequest()
    repository.findOwnedConversationByContextHash.mockResolvedValue(existingConversation)

    const response = await POST(new Request('http://localhost/api/talk-about-this', {
      method: 'POST',
      body: JSON.stringify({ analysisId: 'analysis-1', scope }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      conversationId: 'existing-conversation',
      disposition: 'resumed',
      messages: [{ role: 'user', content: 'Is this significant?' }],
    })
    expect(repository.listConversationMessages).toHaveBeenCalledWith(expect.anything(), 'user-1', 'existing-conversation')
  })

  it('forwards persisted evidence receipts that client hydration accepts', async () => {
    vi.clearAllMocks()
    configureAuthenticatedRequest()
    repository.findOwnedConversationByContextHash.mockResolvedValue(existingConversation)
    repository.evidenceReceiptsForUi.mockReturnValue([{
      evidence: {
        id: 'doi:p3:u1',
        sourceDocumentId: 'doi:p3',
        doi: '10.1000/example',
        title: 'A source',
        pageStart: 3,
        pageEnd: 3,
        quote: 'DMF comparison.',
        similarity: 0.98,
        candidateStatus: 'candidate_pending_adjudication',
      },
      receivedAt: '2026-08-12T00:00:00.000Z',
    }])

    const response = await POST(new Request('http://localhost/api/talk-about-this', {
      method: 'POST',
      body: JSON.stringify({ analysisId: 'analysis-1', scope }),
    }))
    const body = await response.json()

    expect(evidenceFromEvent('done', {
      evidence: body.evidenceReceipts.map((receipt: { evidence: unknown }) => receipt.evidence),
    })).toEqual([repository.evidenceReceiptsForUi.mock.results[0]?.value[0].evidence])
  })

  it('deliberately creates an empty conversation without a context-hash lookup', async () => {
    vi.clearAllMocks()
    configureAuthenticatedRequest()
    repository.createConversation.mockResolvedValue({
      id: 'new-conversation',
      scope,
      context_hash: 'new-context-hash',
    })
    repository.listConversationMessages.mockResolvedValue([])
    repository.conversationHistoryForUi.mockReturnValue([])

    const response = await POST(new Request('http://localhost/api/talk-about-this', {
      method: 'POST',
      body: JSON.stringify({ analysisId: 'analysis-1', scope, newConversation: true }),
    }))

    expect(repository.findOwnedConversationByContextHash).not.toHaveBeenCalled()
    expect(repository.createConversation).toHaveBeenCalled()
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      conversationId: 'new-conversation',
      disposition: 'created',
      messages: [],
      evidenceReceipts: [],
    })
  })

  it('rejects a non-boolean newConversation value', async () => {
    vi.clearAllMocks()
    configureAuthenticatedRequest()

    const response = await POST(new Request('http://localhost/api/talk-about-this', {
      method: 'POST',
      body: JSON.stringify({ analysisId: 'analysis-1', scope, newConversation: 'yes' }),
    }))

    expect(response.status).toBe(400)
  })
})
import { POST as postMessage, activityPayload, mergeActivityTelemetry } from '@/app/api/talk-about-this/[conversationId]/messages/route'

describe('tool-complete activity payload', () => {
  it('accepts long-lived monotonic stage timestamps while rejecting invalid snapshots', () => {
    expect(activityPayload({
      tool: 'search_scoped_literature_evidence',
      telemetry: {
        embeddingStartedAt: 60_001,
        embeddingFinishedAt: 60_002,
        rpcStartedAt: 60_003,
        rpcFinishedAt: 60_004,
      },
    })).toMatchObject({
      tool: 'search_scoped_literature_evidence',
      telemetry: {
        embeddingStartedAt: 60_001,
        embeddingFinishedAt: 60_002,
        rpcStartedAt: 60_003,
        rpcFinishedAt: 60_004,
      },
    })

    expect(activityPayload({
      tool: 'search_scoped_literature_evidence',
      telemetry: { embeddingStartedAt: 20, embeddingFinishedAt: 10, rpcStartedAt: 30 },
    }).telemetry).toBeUndefined()
  })

  it('keeps complete and aborted retrieval attempts as separate terminal snapshots', () => {
    let telemetry = mergeActivityTelemetry(
      { clock: 'performance.now', routeStartedAt: 5 },
      activityPayload({
        callId: 'first',
        tool: 'search_scoped_literature_evidence',
        status: 'ok',
        telemetry: { embeddingStartedAt: 10, embeddingFinishedAt: 20, rpcStartedAt: 30, rpcFinishedAt: 40 },
      }),
    )
    telemetry = mergeActivityTelemetry(telemetry, activityPayload({
      callId: 'second',
      tool: 'search_scoped_literature_evidence',
      status: 'unavailable',
      warnings: ['Literature evidence retrieval aborted'],
      telemetry: { embeddingStartedAt: 100 },
    }))

    expect(telemetry).toEqual({
      clock: 'performance.now',
      routeStartedAt: 5,
      retrievalAttempts: [
        {
          callId: 'first',
          status: 'complete',
          embeddingStartedAt: 10,
          embeddingFinishedAt: 20,
          rpcStartedAt: 30,
          rpcFinishedAt: 40,
        },
        {
          callId: 'second',
          status: 'aborted',
          embeddingStartedAt: 100,
        },
      ],
    })
  })
})

function parseSse(body: string): Array<{ event: string, data: Record<string, unknown> }> {
  return body.trim().split('\n\n').filter(Boolean).map(frame => {
    const [eventLine, dataLine] = frame.split('\n')
    return {
      event: eventLine!.replace('event: ', ''),
      data: JSON.parse(dataLine!.replace('data: ', '')) as Record<string, unknown>,
    }
  })
}

describe('scoped conversation message route diagnostics', () => {
  const conversation = {
    id: 'conversation-1',
    status: 'active',
    context_snapshot: { citations: [] },
  }

  function configureMessageRoute() {
    vi.clearAllMocks()
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
    })
    createAdminClient.mockReturnValue({ rpc: vi.fn() })
    createConfiguredChatProvider.mockReturnValue({ provider: 'configured' })
    repository.loadOwnedConversation.mockResolvedValue(conversation)
    repository.listConversationMessages.mockResolvedValue([])
    repository.createMessage
      .mockResolvedValueOnce({ id: 'persisted-user-message' })
      .mockResolvedValueOnce({ id: 'persisted-assistant-message' })
    repository.createToolRun.mockResolvedValue({ id: 'tool-run-1' })
    repository.linkToolRunsToAssistantMessage.mockResolvedValue(1)
  }

  function messageRequest(signal?: AbortSignal) {
    return new Request('http://localhost/api/talk-about-this/conversation-1/messages', {
      method: 'POST',
      body: JSON.stringify({ content: 'Please investigate this.' }),
      signal,
    })
  }

  it('persists and safely forwards a timed-out tool diagnostic before linking the response', async () => {
    configureMessageRoute()
    runScopedToolChat.mockImplementationOnce(async input => {
      await input.onToolRun({
        turnId: input.turnId!,
        providerRound: 0,
        callId: 'tool-call-1',
        toolName: 'lookup_chem21_solvent',
        validatedArguments: { chemical: 'DMF' },
        status: 'timed_out',
        reasonCode: 'deadline_exceeded',
        reasonDetail: 'raw internal timeout detail',
        telemetry: { elapsedMs: 5_000 },
      })
      input.onEvent('tool-failed', {
        callId: 'tool-call-1',
        tool: 'lookup_chem21_solvent',
        status: 'timed_out',
        source: 'CHEM21',
        reasonCode: 'deadline_exceeded',
        userNote: 'CHEM21 did not finish before the tool deadline.',
        reason: 'raw internal timeout detail',
        reasonDetail: 'raw internal timeout detail',
      })
      return {
        answer: 'A bounded answer.',
        citations: [],
        evidence: [],
        telemetry: {
          scheduling: {
            requestedCount: 1,
            dispatchedCount: 1,
            deduplicatedCount: 0,
            rawDiagnostic: 'do not forward this',
          },
        },
      }
    })

    const response = await postMessage(messageRequest(), { params: Promise.resolve({ conversationId: 'conversation-1' }) })
    const body = await response.text()
    const events = parseSse(body)

    expect(repository.createMessage).toHaveBeenNthCalledWith(1, expect.anything(), 'user-1', 'conversation-1', expect.objectContaining({ role: 'user' }))
    expect(repository.createToolRun).toHaveBeenCalledWith(expect.anything(), 'user-1', expect.objectContaining({
      conversationId: 'conversation-1',
      userMessageId: 'persisted-user-message',
      turnId: expect.any(String),
      status: 'timed_out',
      reasonCode: 'deadline_exceeded',
    }))
    expect(repository.linkToolRunsToAssistantMessage).toHaveBeenCalledWith(expect.anything(), 'user-1', {
      conversationId: 'conversation-1',
      turnId: expect.any(String),
      assistantMessageId: 'persisted-assistant-message',
    })
    expect(events.find(event => event.event === 'tool-failed')?.data).toEqual({
      callId: 'tool-call-1',
      tool: 'lookup_chem21_solvent',
      status: 'timed_out',
      source: 'CHEM21',
      reasonCode: 'deadline_exceeded',
      userNote: 'CHEM21 did not finish before the tool deadline.',
    })
    expect(events.find(event => event.event === 'done')?.data.telemetry).toEqual(expect.objectContaining({
      scheduling: { requestedCount: 1, dispatchedCount: 1, deduplicatedCount: 0 },
    }))
    expect(body).not.toContain('do not forward this')
    expect(body).not.toContain('raw internal timeout detail')
  })

  it('waits for a delayed diagnostic write before linking its terminal assistant message', async () => {
    configureMessageRoute()
    const diagnostic = Promise.withResolvers<void>()
    repository.createToolRun.mockImplementationOnce(() => diagnostic.promise)
    runScopedToolChat.mockImplementationOnce(async input => ({
      answer: 'Answer survives.',
      citations: [],
      evidence: [],
      telemetry: {},
      diagnosticPersistence: input.onToolRun({
        turnId: input.turnId!,
        providerRound: 0,
        callId: 'tool-call-1',
        toolName: 'lookup_chem21_solvent',
        validatedArguments: { chemical: 'DMF' },
        status: 'completed',
        reasonCode: 'none',
        telemetry: {},
      }),
    }))

    const response = await postMessage(messageRequest(), { params: Promise.resolve({ conversationId: 'conversation-1' }) })
    const body = response.text()
    await vi.waitFor(() => expect(repository.createToolRun).toHaveBeenCalledTimes(1))
    expect(repository.linkToolRunsToAssistantMessage).not.toHaveBeenCalled()
    diagnostic.resolve()

    expect(parseSse(await body).find(event => event.event === 'done')?.data).toMatchObject({ status: 'complete' })
    expect(repository.linkToolRunsToAssistantMessage).toHaveBeenCalledTimes(1)
    expect(repository.createToolRun.mock.invocationCallOrder[0]).toBeLessThan(
      repository.linkToolRunsToAssistantMessage.mock.invocationCallOrder[0],
    )
  })

  it('bounds a never-settling diagnostic before linking and closing the terminal SSE', async () => {
    configureMessageRoute()
    const diagnostic = Promise.withResolvers<void>()
    runScopedToolChat.mockResolvedValueOnce({
      answer: 'Answer survives.',
      citations: [],
      evidence: [],
      telemetry: {},
      diagnosticPersistence: diagnostic.promise,
    })

    const response = await postMessage(messageRequest(), { params: Promise.resolve({ conversationId: 'conversation-1' }) })
    const events = parseSse(await response.text())

    expect(repository.linkToolRunsToAssistantMessage).toHaveBeenCalledTimes(1)
    expect(events.filter(event => event.event === 'done')).toHaveLength(1)
    expect(events.find(event => event.event === 'done')?.data).toMatchObject({ status: 'complete' })
  })

  it('persists a cancelled response and emits one terminal done event', async () => {
    configureMessageRoute()
    runScopedToolChat.mockImplementationOnce(async input => {
      await new Promise<void>(resolve => input.signal!.addEventListener('abort', () => resolve(), { once: true }))
      throw new Error('raw cancellation detail')
    })
    const abortController = new AbortController()

    const response = await postMessage(messageRequest(abortController.signal), { params: Promise.resolve({ conversationId: 'conversation-1' }) })
    abortController.abort()
    const body = await response.text()
    const events = parseSse(body)

    expect(events.filter(event => event.event === 'done')).toHaveLength(1)
    expect(events.find(event => event.event === 'done')?.data).toMatchObject({ status: 'cancelled' })
    expect(body).not.toContain('raw cancellation detail')
  })

  it('fails open when diagnostic persistence rejects without exposing its detail', async () => {
    configureMessageRoute()
    repository.createToolRun.mockRejectedValueOnce(new Error('raw diagnostic RPC detail'))
    runScopedToolChat.mockImplementationOnce(async input => {
      await input.onToolRun({
        turnId: input.turnId!,
        providerRound: 0,
        callId: 'tool-call-1',
        toolName: 'lookup_chem21_solvent',
        validatedArguments: { chemical: 'DMF' },
        status: 'failed',
        reasonCode: 'tool_error',
        telemetry: {},
      })
      input.onEvent('tool-failed', {
        callId: 'tool-call-1',
        tool: 'lookup_chem21_solvent',
        status: 'failed',
        source: 'CHEM21',
        reasonCode: 'tool_error',
        userNote: 'CHEM21 could not complete the request.',
        reasonDetail: 'raw diagnostic RPC detail',
      })
      return { answer: 'Answer survives.', citations: [], evidence: [], telemetry: {} }
    })

    const response = await postMessage(messageRequest(), { params: Promise.resolve({ conversationId: 'conversation-1' }) })
    const body = await response.text()

    expect(parseSse(body).find(event => event.event === 'done')?.data).toMatchObject({ status: 'complete' })
    expect(body).not.toContain('raw diagnostic RPC detail')
  })

  it('closes with a generic failure when terminal assistant persistence rejects without linking diagnostics', async () => {
    configureMessageRoute()
    repository.createMessage
      .mockReset()
      .mockResolvedValueOnce({ id: 'persisted-user-message' })
      .mockRejectedValueOnce(new Error('raw assistant database detail'))
    runScopedToolChat.mockResolvedValueOnce({ answer: 'Answer.', citations: [], evidence: [], telemetry: {} })

    const response = await postMessage(messageRequest(), { params: Promise.resolve({ conversationId: 'conversation-1' }) })
    const body = await response.text()
    const events = parseSse(body)

    expect(events.filter(event => event.event === 'done')).toEqual([expect.objectContaining({
      event: 'done',
      data: expect.objectContaining({ status: 'failed' }),
    })])
    expect(events).toContainEqual({
      event: 'error',
      data: { error: 'Chat response could not be saved.' },
    })
    expect(repository.linkToolRunsToAssistantMessage).not.toHaveBeenCalled()
    expect(body).not.toContain('raw assistant database detail')
  })
})
