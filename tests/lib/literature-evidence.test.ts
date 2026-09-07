import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  embeddingCreate: vi.fn(),
  rpc: vi.fn(),
  createAdminClient: vi.fn(),
}))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    embeddings = { create: mocks.embeddingCreate }
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))

const localPipelineMocks = vi.hoisted(() => ({
  isLocalPipelineEnabled: vi.fn(() => false),
}))

vi.mock('@/lib/local-llm', async () => {
  const actual = await vi.importActual<typeof import('@/lib/local-llm')>('@/lib/local-llm')
  return {
    ...actual,
    isLocalPipelineEnabled: localPipelineMocks.isLocalPipelineEnabled,
  }
})

import {
  buildLiteratureQuery,
  citationFromEvidenceMatch,
  LITERATURE_QUERY_MAX_CHARS,
  searchLiteratureEvidence,
} from '@/lib/literature-evidence'

const completeRow = {
  id: 'doi:p2:u1',
  source_document_id: 'doi',
  doi: '10.1039/example',
  title: 'Safer solvent comparison',
  page_start: 2,
  page_end: 2,
  quote: 'Ethyl acetate was a viable replacement under the reported conditions.',
  evidence_type: 'comparison',
  applicability: 'Solvent replacement',
  limitations: 'Substrate-dependent',
  candidate_status: 'candidate_pending_adjudication',
  similarity: 0.81,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

beforeEach(() => {
  localPipelineMocks.isLocalPipelineEnabled.mockReset().mockReturnValue(false)
  mocks.embeddingCreate.mockReset().mockResolvedValue({
    data: [{ embedding: new Array(1536).fill(0.1) }],
  })
  mocks.rpc.mockReset().mockResolvedValue({ data: [completeRow], error: null })
  mocks.createAdminClient.mockReset().mockReturnValue({ rpc: mocks.rpc })
})

describe('searchLiteratureEvidence', () => {
  it('embeds a bounded query and returns page-bounded candidate evidence', async () => {
    const matches = await searchLiteratureEvidence({
      query: 'replace DMF with ethyl acetate',
      limit: 5,
      threshold: 0.25,
      signalGroups: ['comparison'],
    })

    expect(matches).toEqual([
      expect.objectContaining({
        id: 'doi:p2:u1',
        pageStart: 2,
        pageEnd: 2,
        candidateStatus: 'candidate_pending_adjudication',
      }),
    ])
    expect(mocks.embeddingCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: 'replace DMF with ethyl acetate',
    }, undefined)
    expect(mocks.rpc).toHaveBeenCalledWith(
      'match_literature_evidence_units',
      expect.objectContaining({
        match_count: 5,
        requested_visibility: 'public',
        filter_signal_groups: ['comparison'],
      }),
    )
  })

  it('reports monotonic embedding and evidence-RPC boundaries without timing synthetic events', async () => {
    const telemetry: Array<Partial<Record<'embeddingStartedAt' | 'embeddingFinishedAt' | 'rpcStartedAt' | 'rpcFinishedAt', number>>> = []
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(30)
      .mockReturnValueOnce(40)

    await searchLiteratureEvidence({
      query: 'DMF comparison',
      limit: 5,
      threshold: 0.25,
      onTelemetry: timing => telemetry.push(timing),
    })

    expect(telemetry).toEqual([
      { embeddingStartedAt: 10 },
      { embeddingStartedAt: 10, embeddingFinishedAt: 20 },
      { embeddingStartedAt: 10, embeddingFinishedAt: 20, rpcStartedAt: 30 },
      { embeddingStartedAt: 10, embeddingFinishedAt: 20, rpcStartedAt: 30, rpcFinishedAt: 40 },
    ])
  })

  it.each(['', 'x'.repeat(501)])('rejects invalid query %j before embedding', async (query) => {
    await expect(searchLiteratureEvidence({ query, limit: 5, threshold: 0.25 }))
      .rejects.toThrow('query')
    expect(mocks.embeddingCreate).not.toHaveBeenCalled()
  })

  it.each([0, 6, 1.5])('rejects invalid limit %d before embedding', async (limit) => {
    await expect(searchLiteratureEvidence({ query: 'DMF comparison', limit, threshold: 0.25 }))
      .rejects.toThrow('limit')
    expect(mocks.embeddingCreate).not.toHaveBeenCalled()
  })

  it('rejects unsupported signal groups before embedding', async () => {
    await expect(searchLiteratureEvidence({
      query: 'DMF comparison',
      limit: 5,
      threshold: 0.25,
      signalGroups: ['unsupported'] as never,
    })).rejects.toThrow('signal group')
    expect(mocks.embeddingCreate).not.toHaveBeenCalled()
  })

  it('omits malformed RPC rows rather than creating citations from them', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ ...completeRow, quote: '', similarity: Number.NaN }],
      error: null,
    })

    await expect(searchLiteratureEvidence({ query: 'DMF comparison', limit: 5, threshold: 0.25 }))
      .resolves.toEqual([])
  })

  it('returns zero matches when the RPC has no rows', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })

    await expect(searchLiteratureEvidence({ query: 'DMF comparison', limit: 5, threshold: 0.25 }))
      .resolves.toEqual([])
  })

  it('propagates RPC errors', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('pgvector failure') })

    await expect(searchLiteratureEvidence({ query: 'DMF comparison', limit: 5, threshold: 0.25 }))
      .rejects.toThrow('pgvector failure')
  })

  it('rejects an already-aborted caller signal before embedding', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(searchLiteratureEvidence({
      query: 'DMF comparison',
      limit: 5,
      threshold: 0.25,
      signal: controller.signal,
    })).rejects.toThrow(/abort/i)
    expect(mocks.embeddingCreate).not.toHaveBeenCalled()
  })

  it('rejects after abort instead of returning a late RPC evidence result', async () => {
    const rpcResult = deferred<{ data: typeof completeRow[]; error: null }>()
    mocks.rpc.mockReturnValueOnce(rpcResult.promise)
    const controller = new AbortController()
    const search = searchLiteratureEvidence({
      query: 'DMF comparison',
      limit: 5,
      threshold: 0.25,
      signal: controller.signal,
    })

    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce())
    controller.abort()
    rpcResult.resolve({ data: [completeRow], error: null })

    await expect(search).rejects.toThrow(/abort/i)
  })
})

describe('citationFromEvidenceMatch', () => {
  it('uses the evidence unit ID and page range in its citation', () => {
    const citation = citationFromEvidenceMatch({
      id: 'doi:p2:u1',
      sourceDocumentId: 'doi',
      doi: '10.1039/example',
      title: 'Safer solvent comparison',
      pageStart: 2,
      pageEnd: 4,
      quote: 'A page-bounded quote.',
      candidateStatus: 'candidate_pending_adjudication',
      similarity: 0.81,
    })

    expect(citation).toMatchObject({
      source_id: 'doi:p2:u1',
      source_name: 'Safer solvent comparison',
      doi: '10.1039/example',
    })
    expect(citation.citation).toContain('pp. 2–4')
  })
})


describe('buildLiteratureQuery', () => {
  it('builds a chemicals-first query without rationale', () => {
    expect(buildLiteratureQuery('DMF', 'ethyl acetate')).toBe(
      'Green chemistry alternative for DMF: ethyl acetate',
    )
  })

  it('appends rationale when under the 500-char limit', () => {
    const q = buildLiteratureQuery('DMF', 'ethyl acetate', 'Lower toxicity solvent')
    expect(q).toBe(
      'Green chemistry alternative for DMF: ethyl acetate. Lower toxicity solvent',
    )
    expect(q.length).toBeLessThanOrEqual(LITERATURE_QUERY_MAX_CHARS)
  })

  it('truncates long rationales instead of exceeding 500 chars', () => {
    const long = 'x'.repeat(800)
    const q = buildLiteratureQuery('Dichloromethane', 'Ethyl acetate', long)
    expect(q.length).toBe(LITERATURE_QUERY_MAX_CHARS)
    expect(q.startsWith('Green chemistry alternative for Dichloromethane: Ethyl acetate. ')).toBe(true)
    expect(q.includes('x')).toBe(true)
  })

  it('never exceeds 500 even with very long chemical names', () => {
    const longName = 'A'.repeat(300)
    const q = buildLiteratureQuery(longName, longName, 'rationale '.repeat(50))
    expect(q.length).toBeLessThanOrEqual(LITERATURE_QUERY_MAX_CHARS)
    expect(q.length).toBeGreaterThan(0)
  })
})
