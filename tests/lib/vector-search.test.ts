import { describe, it, expect, vi } from 'vitest'

// Mock before importing the module under test
vi.mock('openai', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    data: [{ embedding: new Array(1536).fill(0.1) }],
  })
  function MockOpenAI() {
    return { embeddings: { create: mockCreate } }
  }
  return { default: MockOpenAI }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockReturnValue({
    rpc: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'test-id',
          title: 'Green solvents review',
          authors: 'Smith et al.',
          journal: 'Green Chemistry',
          year: 2023,
          doi: '10.1039/test',
          url: 'https://doi.org/10.1039/test',
          content_snippet: 'DMSO shows lower toxicity than DMF in...',
          similarity: 0.85,
        },
      ],
      error: null,
    }),
  }),
}))

describe('searchLiterature', () => {
  it('returns shaped SearchResult array', async () => {
    const { searchLiterature } = await import('@/lib/vector-search')
    const results = await searchLiterature({
      query: 'replace DMF with safer solvent',
      limit: 3,
      threshold: 0.35,
      principles: [5],
      chemicals: ['dmf', 'dmso'],
    })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 'test-id',
      title: 'Green solvents review',
      similarity: 0.85,
    })
  })

  it('returns empty array when RPC returns no data', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValueOnce({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as never)
    const { searchLiterature } = await import('@/lib/vector-search')
    const results = await searchLiterature({
      query: 'obscure query with no hits',
      limit: 3,
      threshold: 0.35,
    })
    expect(results).toEqual([])
  })

  it('throws when RPC returns an error', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValueOnce({
      rpc: vi.fn().mockResolvedValue({ data: null, error: new Error('pgvector failure') }),
    } as never)
    const { searchLiterature } = await import('@/lib/vector-search')
    await expect(searchLiterature({ query: 'test', limit: 3, threshold: 0.35 }))
      .rejects.toThrow('pgvector failure')
  })
})
