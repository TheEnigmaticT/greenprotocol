import type { LiteratureEvidenceMatch } from '@/lib/types'

export interface PersistedEvidence {
  id: string
  sourceDocumentId: string
  doi?: string
  title: string
  pageStart: number
  pageEnd: number
  quote: string
  similarity: number
  applicability?: string
  limitations?: string
  candidateStatus: string
}

export interface PersistedEvidenceReceipt {
  evidence: PersistedEvidence
  receivedAt: string
}

export function isPersistedEvidence(value: unknown): value is PersistedEvidence {
  if (!value || typeof value !== 'object') return false
  const evidence = value as Record<string, unknown>

  return typeof evidence.id === 'string'
    && Boolean(evidence.id.trim())
    && typeof evidence.sourceDocumentId === 'string'
    && Boolean(evidence.sourceDocumentId.trim())
    && (evidence.doi === undefined || typeof evidence.doi === 'string')
    && typeof evidence.title === 'string'
    && Boolean(evidence.title.trim())
    && typeof evidence.pageStart === 'number'
    && Number.isSafeInteger(evidence.pageStart)
    && evidence.pageStart > 0
    && typeof evidence.pageEnd === 'number'
    && Number.isSafeInteger(evidence.pageEnd)
    && evidence.pageEnd >= evidence.pageStart
    && typeof evidence.quote === 'string'
    && Boolean(evidence.quote.trim())
    && typeof evidence.similarity === 'number'
    && Number.isFinite(evidence.similarity)
    && (evidence.applicability === undefined || typeof evidence.applicability === 'string')
    && (evidence.limitations === undefined || typeof evidence.limitations === 'string')
    && typeof evidence.candidateStatus === 'string'
    && Boolean(evidence.candidateStatus.trim())
}

export function asLiteratureEvidenceMatch(evidence: PersistedEvidence): LiteratureEvidenceMatch {
  return evidence
}
