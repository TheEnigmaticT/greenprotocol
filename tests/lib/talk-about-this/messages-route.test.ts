import { describe, expect, it, vi } from 'vitest'
import type * as TalkAboutContextModule from '@/lib/talk-about-this/context'

const repository = vi.hoisted(() => ({
  createConversation: vi.fn(),
  evidenceReceiptsForUi: vi.fn(),
  findOwnedConversationByContextHash: vi.fn(),
  conversationHistoryForUi: vi.fn(),
  listConversationMessages: vi.fn(),
  loadOwnedAnalysis: vi.fn(),
  loadOwnedRecommendationApprovalReceipt: vi.fn(),
}))
const createClient = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({ createClient }))
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
import { activityPayload, mergeActivityTelemetry } from '@/app/api/talk-about-this/[conversationId]/messages/route'

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
