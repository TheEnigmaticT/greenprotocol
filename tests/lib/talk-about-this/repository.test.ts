import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  assistantMessageCitations,
  createToolRun,
  linkToolRunsToAssistantMessage,
  receiptFromStoredAction,
} from '@/lib/talk-about-this/repository'
import type { Citation, LiteratureEvidenceMatch } from '@/lib/types'

const literatureCitation: Citation = {
  source_id: 'doi:p3:u1',
  source_name: 'A source',
  citation: 'A source. pp. 3–3.',
  doi: '10.1000/example',
}

const evidence: LiteratureEvidenceMatch = {
  id: 'doi:p3:u1',
  sourceDocumentId: 'doi:p3',
  doi: '10.1000/example',
  title: 'A source',
  pageStart: 3,
  pageEnd: 3,
  quote: 'DMF comparison.',
  applicability: 'DMF replacement',
  limitations: 'Candidate evidence only.',
  candidateStatus: 'candidate_pending_adjudication',
  similarity: 0.98,
}

describe('assistantMessageCitations', () => {
  it('persists reconstructible evidence metadata for retrieved literature citations', () => {
    expect(assistantMessageCitations([], [literatureCitation], [evidence])).toEqual([{
      ...literatureCitation,
      evidence: {
        id: 'doi:p3:u1',
        sourceDocumentId: 'doi:p3',
        doi: '10.1000/example',
        title: 'A source',
        pageStart: 3,
        pageEnd: 3,
        quote: 'DMF comparison.',
        applicability: 'DMF replacement',
        limitations: 'Candidate evidence only.',
        candidateStatus: 'candidate_pending_adjudication',
      },
    }])
  })

  it('embeds structured atomic retrieval attempt telemetry in citations JSONB', () => {
    expect(assistantMessageCitations([], [], [], {
      clock: 'performance.now',
      routeStartedAt: 10,
      initialProviderFirstTextAt: 20,
      finalProviderFirstTextAt: 70,
      retrievalAttempts: [{
        callId: 'lit-1',
        status: 'complete',
        embeddingStartedAt: 30,
        embeddingFinishedAt: 40,
        rpcStartedAt: 50,
        rpcFinishedAt: 60,
      }],
    })).toEqual([{
      telemetry: {
        clock: 'performance.now',
        routeStartedAt: 10,
        initialProviderFirstTextAt: 20,
        finalProviderFirstTextAt: 70,
        retrievalAttempts: [{
          callId: 'lit-1',
          status: 'complete',
          embeddingStartedAt: 30,
          embeddingFinishedAt: 40,
          rpcStartedAt: 50,
          rpcFinishedAt: 60,
        }],
      },
    }])
  })
})

describe('receiptFromStoredAction', () => {
  it('recovers the durable action identity and revision without consulting message text', () => {
    expect(receiptFromStoredAction({
      id: 'action-persisted',
      target_recommendation_id: 'rec-1',
      label: 'Use ethyl acetate',
      already_applied: false,
      revision_number: 9,
      completed_at: '2026-08-12T00:00:00.000Z',
    })).toEqual({
      actionId: 'action-persisted',
      recommendationId: 'rec-1',
      label: 'Use ethyl acetate',
      alreadyAccepted: false,
      revisionNumber: 9,
      receivedAt: '2026-08-12T00:00:00.000Z',
    })
  })

  it('rejects incomplete persisted actions rather than inferring a receipt from chat content', () => {
    expect(receiptFromStoredAction({
      id: 'action-persisted',
      target_recommendation_id: 'rec-1',
      label: 'Use ethyl acetate',
      already_applied: false,
      revision_number: 9,
      completed_at: null,
    })).toBeNull()
  })
})

describe('tool-run diagnostics', () => {
  const toolRunInput = {
    conversationId: 'conversation-1',
    userMessageId: 'message-1',
    turnId: 'turn-1',
    providerRound: 0,
    callId: 'call-1',
    toolName: 'lookup_chem21_solvent',
    validatedArguments: { chemical: 'dichloromethane' },
    status: 'timed_out' as const,
    reasonCode: 'deadline_exceeded' as const,
    reasonDetail: 'provider error: sk-should-never-be-persisted',
    dispatchBudgetMs: 5000,
    startedAt: '2026-08-12T00:00:00.000Z',
    completedAt: '2026-08-12T00:00:05.000Z',
    elapsedMs: 5000,
    telemetry: {},
  }

  it('records a bounded owner-scoped diagnostic through the RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        id: 'run-1',
        status: 'timed_out',
        reason_code: 'deadline_exceeded',
      }],
      error: null,
    })

    const result = await createToolRun({ rpc } as never, 'user-1', toolRunInput)

    expect(result.status).toBe('timed_out')
    expect(rpc).toHaveBeenCalledWith('record_scoped_tool_run', expect.objectContaining({
      p_user_id: 'user-1',
      p_conversation_id: 'conversation-1',
      p_user_message_id: 'message-1',
      p_status: 'timed_out',
      p_reason_code: 'deadline_exceeded',
      p_reason_detail: 'The tool did not finish before its dispatch deadline.',
    }))
  })

  it('redacts token-bearing values from diagnostic JSON RPC payloads', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'run-1', status: 'timed_out', reason_code: 'deadline_exceeded' }],
      error: null,
    })

    await createToolRun({ rpc } as never, 'user-1', {
      ...toolRunInput,
      validatedArguments: {
        chemical: 'dichloromethane',
        apiKey: 'sk-validated-arguments-secret',
        nestedError: { message: 'database password: secret' },
      },
      telemetry: {
        elapsedMs: 5000,
        providerError: 'Bearer telemetry-secret',
        request: { authorization: 'token secret' },
      },
    })

    expect(rpc).toHaveBeenCalledWith('record_scoped_tool_run', expect.objectContaining({
      p_validated_arguments: { chemical: 'dichloromethane' },
      p_telemetry: { elapsedMs: 5000 },
    }))
  })

  it('omits free-form query and telemetry strings even under allowed keys', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'run-1', status: 'timed_out', reason_code: 'deadline_exceeded' }],
      error: null,
    })

    await createToolRun({ rpc } as never, 'user-1', {
      ...toolRunInput,
      validatedArguments: {
        chemical: 'dichloromethane',
        query: 'Bearer query-secret caused provider error',
      },
      telemetry: {
        elapsedMs: 5000,
        startedAt: 'token telemetry-secret',
        completedAt: 'raw error with password',
      },
    })

    expect(rpc).toHaveBeenCalledWith('record_scoped_tool_run', expect.objectContaining({
      p_validated_arguments: { chemical: 'dichloromethane' },
      p_telemetry: { elapsedMs: 5000 },
    }))
  })

  it('declares authenticated browser roles unable to execute diagnostic RPCs', () => {
    const migration = readFileSync(resolve(
      process.cwd(),
      'supabase/migrations/20260812000001_create_talk_tool_runs.sql',
    ), 'utf8')

    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.record_scoped_tool_run(UUID, UUID, UUID, UUID, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;',
    )
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.link_scoped_tool_runs_to_assistant_message(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;',
    )
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.record_scoped_tool_run(UUID, UUID, UUID, UUID, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, JSONB) TO service_role;',
    )
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.link_scoped_tool_runs_to_assistant_message(UUID, UUID, UUID, UUID) TO service_role;',
    )
  })

  it('rejects invalid local diagnostic values before calling the RPC', async () => {
    const rpc = vi.fn()

    await expect(createToolRun({ rpc } as never, 'user-1', {
      ...toolRunInput,
      callId: '',
    })).rejects.toThrow('Invalid tool-run diagnostic input')

    expect(rpc).not.toHaveBeenCalled()
  })

  it('throws a bounded persistence error when recording fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'connection details and secret' },
    })

    await expect(createToolRun({ rpc } as never, 'user-1', toolRunInput))
      .rejects.toThrow('Unable to persist tool-run diagnostic')
    await expect(createToolRun({ rpc } as never, 'user-1', toolRunInput))
      .rejects.not.toThrow('connection details and secret')
  })

  it('links only the server-owned turn through the RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null })

    await expect(linkToolRunsToAssistantMessage({ rpc } as never, 'user-1', {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      assistantMessageId: 'assistant-message-1',
    })).resolves.toBe(1)

    expect(rpc).toHaveBeenCalledWith('link_scoped_tool_runs_to_assistant_message', {
      p_user_id: 'user-1',
      p_conversation_id: 'conversation-1',
      p_turn_id: 'turn-1',
      p_assistant_message_id: 'assistant-message-1',
    })
  })

  it('returns zero when no diagnostics are linkable', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 0, error: null })

    await expect(linkToolRunsToAssistantMessage({ rpc } as never, 'user-1', {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      assistantMessageId: 'assistant-message-1',
    })).resolves.toBe(0)
  })

  it('throws a bounded persistence error when linking fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'permission details and secret' },
    })

    await expect(linkToolRunsToAssistantMessage({ rpc } as never, 'user-1', {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      assistantMessageId: 'assistant-message-1',
    })).rejects.toThrow('Unable to persist tool-run diagnostic')
  })
})
