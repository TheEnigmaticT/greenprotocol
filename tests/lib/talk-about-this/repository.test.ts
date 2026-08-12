import { describe, expect, it } from 'vitest'
import { assistantMessageCitations } from '@/lib/talk-about-this/repository'
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

  it('embeds structured monotonic timing telemetry in citations JSONB', () => {
    expect(assistantMessageCitations([], [], [], {
      clock: 'performance.now',
      routeStartedAt: 10,
      initialProviderFirstTextAt: 20,
      embeddingStartedAt: 30,
      embeddingFinishedAt: 40,
      rpcStartedAt: 50,
      rpcFinishedAt: 60,
      finalProviderFirstTextAt: 70,
    })).toEqual([{
      telemetry: {
        clock: 'performance.now',
        routeStartedAt: 10,
        initialProviderFirstTextAt: 20,
        embeddingStartedAt: 30,
        embeddingFinishedAt: 40,
        rpcStartedAt: 50,
        rpcFinishedAt: 60,
        finalProviderFirstTextAt: 70,
      },
    }])
  })
})
