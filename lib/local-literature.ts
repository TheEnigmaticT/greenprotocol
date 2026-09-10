/**
 * Fail-closed local dense literature retrieval (Ollama nomic embeddings).
 * Used when GCAI_LOCAL_PIPELINE / GCAI_LOCAL_PARSE is on so OpenAI is not required.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { isLocalPipelineEnabled } from '@/lib/local-llm'
import type { LiteratureEvidenceMatch } from '@/lib/types'

export const LOCAL_EMBED_MODEL = 'nomic-embed-text'
export const LOCAL_EMBED_DIMS = 768

interface DenseRow {
  evidence_unit_id: string
  document_id?: string
  doi?: string
  title: string
  page_start: number
  page_end: number
  quote: string
  candidate_status: string
  evidence_type?: string
  applicability?: string
  limitations?: string
}

interface DenseMeta {
  embedding_model: string
  dims: number
  count: number
  rows: DenseRow[]
}

export interface LocalLiteratureEnv {
  [key: string]: string | undefined
  GCAI_LOCAL_PIPELINE?: string
  GCAI_LOCAL_PARSE?: string
  GCAI_LOCAL_EVIDENCE_INDEX?: string
}

let cached: { dir: string; meta: DenseMeta; matrix: Float32Array } | null = null

export function localEvidenceIndexPath(env: LocalLiteratureEnv = process.env): string | null {
  if (!isLocalPipelineEnabled(env)) return null
  const dir = env.GCAI_LOCAL_EVIDENCE_INDEX?.trim()
  return dir || null
}

async function loadIndex(dir: string) {
  if (cached?.dir === dir) return cached
  const meta = JSON.parse(await readFile(path.join(dir, 'metadata.json'), 'utf8')) as DenseMeta
  if (meta.embedding_model !== LOCAL_EMBED_MODEL || meta.dims !== LOCAL_EMBED_DIMS) {
    throw new Error('local_evidence_index_model_mismatch')
  }
  if (!Array.isArray(meta.rows) || meta.rows.length !== meta.count || meta.count < 1) {
    throw new Error('local_evidence_index_invalid')
  }
  const buf = await readFile(path.join(dir, 'matrix.f32'))
  const expected = meta.count * meta.dims * 4
  if (buf.byteLength !== expected) {
    throw new Error(`local_evidence_index_matrix_size:${buf.byteLength}!=${expected}`)
  }
  cached = { dir, meta, matrix: new Float32Array(buf.buffer, buf.byteOffset, meta.count * meta.dims) }
  return cached
}

async function embedQuery(text: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<Float32Array> {
  const response = await fetchImpl('http://127.0.0.1:11434/api/embed', {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: LOCAL_EMBED_MODEL, input: text }),
  })
  if (!response.ok) throw new Error('local_embed_http_failed')
  const data = await response.json() as { embeddings?: number[][] }
  const emb = data.embeddings?.[0]
  if (!Array.isArray(emb) || emb.length !== LOCAL_EMBED_DIMS) {
    throw new Error('local_embed_response_invalid')
  }
  return Float32Array.from(emb)
}

function cosine(a: Float32Array, bOffset: number, matrix: Float32Array, dims: number): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < dims; i++) {
    const x = a[i]
    const y = matrix[bOffset + i]
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export async function searchLocalLiteratureEvidence(options: {
  query: string
  limit: number
  threshold: number
  indexDir?: string
  fetchImpl?: typeof fetch
  env?: LocalLiteratureEnv
}): Promise<LiteratureEvidenceMatch[]> {
  const query = options.query.trim()
  if (query.length < 1 || query.length > 500) {
    throw new Error('Literature evidence query must contain 1–500 characters')
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 5) {
    throw new Error('Literature evidence limit must be an integer between 1 and 5')
  }

  const dir = options.indexDir ?? localEvidenceIndexPath(options.env ?? process.env)
  if (!dir) throw new Error('local_evidence_index_missing')

  const { meta, matrix } = await loadIndex(dir)
  const q = await embedQuery(query, options.fetchImpl)
  const scored: { i: number; score: number }[] = []
  for (let i = 0; i < meta.count; i++) {
    const score = cosine(q, i * meta.dims, matrix, meta.dims)
    if (score >= options.threshold) scored.push({ i, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, options.limit).map(({ i, score }) => {
    const row = meta.rows[i]
    return {
      id: row.evidence_unit_id,
      sourceDocumentId: row.document_id || row.evidence_unit_id,
      doi: row.doi,
      title: row.title,
      pageStart: row.page_start,
      pageEnd: row.page_end,
      quote: row.quote,
      evidenceType: row.evidence_type,
      applicability: row.applicability,
      limitations: row.limitations,
      candidateStatus: row.candidate_status,
      similarity: score,
    }
  })
}
