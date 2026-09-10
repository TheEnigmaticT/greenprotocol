import { describe, expect, it, vi, afterEach } from 'vitest'
import { LOCAL_EMBED_DIMS, searchLocalLiteratureEvidence } from '@/lib/local-literature'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('searchLocalLiteratureEvidence', () => {
  it('ranks local dense rows without OpenAI', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gc-dense-'))
    const dims = LOCAL_EMBED_DIMS
    const rows = [{
      evidence_unit_id: 'u1',
      document_id: 'd1',
      title: 'Ethanol paper',
      page_start: 1,
      page_end: 2,
      quote: 'Replace ethanol with water when feasible.',
      candidate_status: 'candidate_pending_adjudication',
    }]
    // unit vector along first axis
    const matrix = new Float32Array(dims)
    matrix[0] = 1
    await writeFile(path.join(dir, 'metadata.json'), JSON.stringify({
      embedding_model: 'nomic-embed-text',
      dims,
      count: 1,
      rows,
    }))
    await writeFile(path.join(dir, 'matrix.f32'), Buffer.from(matrix.buffer))

    const emb = new Array(dims).fill(0)
    emb[0] = 1
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ embeddings: [emb] }), { status: 200 }))

    const hits = await searchLocalLiteratureEvidence({
      query: 'ethanol water solvent',
      limit: 3,
      threshold: 0.1,
      indexDir: dir,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('u1')
    expect(hits[0].similarity).toBeCloseTo(1, 5)
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/embed')
  })
})
