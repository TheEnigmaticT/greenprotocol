import OpenAI from 'openai'
import {
  CompatibleModelConfigurationError,
  isCandidateEngineSelected,
  OPENROUTER_COMPATIBLE_BASE_URL,
} from '@/lib/model-runtime'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  Citation,
  EvidenceSignalGroup,
  LiteratureEvidenceMatch,
} from '@/lib/types'

export type { EvidenceSignalGroup, LiteratureEvidenceMatch } from '@/lib/types'

const SUPPORTED_SIGNAL_GROUPS: Record<EvidenceSignalGroup, true> = {
  comparison: true,
  process: true,
  outcome: true,
  hazard: true,
}

export interface LiteratureEvidenceTiming {
  embeddingStartedAt?: number
  embeddingFinishedAt?: number
  rpcStartedAt?: number
  rpcFinishedAt?: number
}

interface SearchLiteratureEvidenceInput {
  query: string
  limit: number
  threshold: number
  signalGroups?: EvidenceSignalGroup[]
  signal?: AbortSignal
  onTelemetry?: (timing: LiteratureEvidenceTiming) => void
}

interface EvidenceRpcRow {
  id?: unknown
  source_document_id?: unknown
  doi?: unknown
  title?: unknown
  page_start?: unknown
  page_end?: unknown
  quote?: unknown
  evidence_type?: unknown
  applicability?: unknown
  limitations?: unknown
  candidate_status?: unknown
  similarity?: unknown
}

function abortError(): Error {
  const error = new Error('Literature evidence retrieval aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError()
}

function awaitWithAbort<T>(operation: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(operation)
  throwIfAborted(signal)

  return new Promise<T>((resolve, reject) => {
    const rejectOnAbort = () => reject(abortError())
    signal.addEventListener('abort', rejectOnAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', rejectOnAbort)
        if (signal.aborted) reject(abortError())
        else resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', rejectOnAbort)
        reject(error)
      },
    )
  })
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function optionalString(value: unknown): string | undefined {
  return nonEmptyString(value) ? value : undefined
}

function configuredValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim()
  return value || undefined
}

interface CandidateEmbeddingRuntime {
  baseURL: string
  model: string
  apiKey: string
}

function resolveCandidateEmbeddingRuntime(
  env: NodeJS.ProcessEnv = process.env,
): CandidateEmbeddingRuntime | undefined {
  if (!isCandidateEngineSelected(env)) return undefined

  const baseURL = configuredValue(env, 'GCAI_EMBEDDING_BASE_URL')
  if (!baseURL) {
    throw new CompatibleModelConfigurationError(
      'GCAI_EMBEDDING_BASE_URL is required when GCAI_ENGINE_CANDIDATE=1',
    )
  }

  const model = configuredValue(env, 'GCAI_EMBEDDING_MODEL')
  if (!model) {
    throw new CompatibleModelConfigurationError(
      'GCAI_EMBEDDING_MODEL is required when GCAI_ENGINE_CANDIDATE=1',
    )
  }

  const apiKey = configuredValue(env, 'GCAI_EMBEDDING_API_KEY') ?? (
    baseURL === OPENROUTER_COMPATIBLE_BASE_URL
      ? configuredValue(env, 'OPENROUTER_API_KEY')
      : undefined
  )
  if (!apiKey) {
    throw new CompatibleModelConfigurationError(
      'GCAI_EMBEDDING_API_KEY is required for the selected candidate endpoint',
    )
  }

  return { baseURL, model, apiKey }
}

function shapeEvidenceMatch(row: unknown): LiteratureEvidenceMatch | null {
  if (!row || typeof row !== 'object') return null
  const value = row as EvidenceRpcRow

  if (
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.source_document_id) ||
    !nonEmptyString(value.title) ||
    !nonEmptyString(value.quote) ||
    !nonEmptyString(value.candidate_status) ||
    typeof value.page_start !== 'number' ||
    !Number.isInteger(value.page_start) ||
    value.page_start <= 0 ||
    typeof value.page_end !== 'number' ||
    !Number.isInteger(value.page_end) ||
    value.page_end < value.page_start ||
    typeof value.similarity !== 'number' ||
    !Number.isFinite(value.similarity)
  ) {
    return null
  }

  return {
    id: value.id,
    sourceDocumentId: value.source_document_id,
    doi: optionalString(value.doi),
    title: value.title,
    pageStart: value.page_start,
    pageEnd: value.page_end,
    quote: value.quote,
    evidenceType: optionalString(value.evidence_type),
    applicability: optionalString(value.applicability),
    limitations: optionalString(value.limitations),
    candidateStatus: value.candidate_status,
    similarity: value.similarity,
  }
}

function validateInput(input: SearchLiteratureEvidenceInput): string {
  const query = input.query.trim()
  if (query.length < 1 || query.length > 500) {
    throw new Error('Literature evidence query must contain 1–500 characters')
  }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 5) {
    throw new Error('Literature evidence limit must be an integer between 1 and 5')
  }
  if (input.signalGroups?.some((group) => !SUPPORTED_SIGNAL_GROUPS[group])) {
    throw new Error('Unsupported literature evidence signal group')
  }
  return query
}

function reportTiming(
  input: SearchLiteratureEvidenceInput,
  timing: LiteratureEvidenceTiming,
): void {
  input.onTelemetry?.({ ...timing })
}

export async function searchLiteratureEvidence(
  input: SearchLiteratureEvidenceInput,
): Promise<LiteratureEvidenceMatch[]> {
  const query = validateInput(input)
  throwIfAborted(input.signal)

  const candidateRuntime = resolveCandidateEmbeddingRuntime()
  // Parity mode changes transport only: same embedding model, index and query.
  const viaOpenRouter = !candidateRuntime && process.env.GCAI_QWEN_PARITY === '1'
  const openai = new OpenAI(candidateRuntime ? {
    apiKey: candidateRuntime.apiKey,
    baseURL: candidateRuntime.baseURL,
    maxRetries: 0,
    timeout: 120_000,
  } : viaOpenRouter ? {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    maxRetries: 0,
    timeout: 120_000,
  } : { apiKey: process.env.OPENAI_API_KEY })
  const timing: LiteratureEvidenceTiming = { embeddingStartedAt: performance.now() }
  reportTiming(input, timing)
  const embeddingResponse = await awaitWithAbort(
    openai.embeddings.create(
      {
        model: candidateRuntime?.model ?? (
          viaOpenRouter ? 'openai/text-embedding-3-small' : 'text-embedding-3-small'
        ),
        input: query,
      },
      input.signal ? { signal: input.signal } : undefined,
    ),
    input.signal,
  )
  timing.embeddingFinishedAt = performance.now()
  reportTiming(input, timing)
  throwIfAborted(input.signal)

  const embedding = embeddingResponse.data[0]?.embedding
  if (!embedding) throw new Error('Literature evidence embedding was empty')

  timing.rpcStartedAt = performance.now()
  reportTiming(input, timing)

  const { data, error } = await awaitWithAbort(
    createAdminClient().rpc('match_literature_evidence_units', {
      query_embedding: embedding,
      match_threshold: input.threshold,
      match_count: input.limit,
      requested_visibility: 'public',
      filter_signal_groups: input.signalGroups ?? [],
    }),
    input.signal,
  )
  timing.rpcFinishedAt = performance.now()
  reportTiming(input, timing)
  throwIfAborted(input.signal)

  if (error) throw error
  if (!Array.isArray(data)) return []
  return data
    .map(shapeEvidenceMatch)
    .filter((match): match is LiteratureEvidenceMatch => match !== null)
}

export function citationFromEvidenceMatch(match: LiteratureEvidenceMatch): Citation {
  const pages = `pp. ${match.pageStart}–${match.pageEnd}`
  const doi = match.doi ? ` DOI: ${match.doi}.` : ''

  return {
    source_id: match.id,
    source_name: match.title,
    citation: `${match.title}. ${pages}.${doi}`,
    doi: match.doi,
  }
}
