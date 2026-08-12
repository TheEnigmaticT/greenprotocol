import { describe, expect, it } from 'vitest'
import { assistantMessageCitations, receiptFromStoredAction } from '@/lib/talk-about-this/repository'
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
