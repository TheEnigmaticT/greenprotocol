import { MAX_SCISURE_WRITEBACK_BYTES } from './workspace-contract'
import type { PreparedSciSureWriteback, SciSureWorkspaceDecision, SciSureWorkspaceFinding, SciSureWritebackResult } from './workspace-contract'

export type BridgeAuth = { sessionId: string; credential: string; sourceOrigin: string }
type SourceLike = { externalId?: string; externalVersionId?: string | null; selection?: ReadonlyArray<{ sectionId?: string; stepId?: string; order: number }> }

const ID = /^[A-Za-z0-9._:-]{1,160}$/
const RESULT_STATUSES: Record<SciSureWritebackResult['status'], true> = { saved: true, conflict: true, unsupported: true, failed: true, uncertain: true }

/** Credential is a bearer held in memory only; never put it in a URL or storage. */
export function bridgeHeaders(auth: BridgeAuth, json = false): Record<string, string> {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${auth.credential}`,
    'X-GCAI-Bridge-Session': auth.sessionId,
    'X-GCAI-SciSure-Origin': auth.sourceOrigin,
    'Cache-Control': 'no-store',
  }
}

/** Identity the add-on compares byte-for-byte against the source it admitted. */
export function sourceIdentity(source: SourceLike | undefined) {
  return {
    externalId: source?.externalId,
    externalVersionId: source?.externalVersionId || null,
    selectionIds: (source?.selection || []).map(selection => selection.sectionId || selection.stepId || `#${selection.order}`),
  }
}

export function applyDecision(findings: readonly SciSureWorkspaceFinding[], findingId: string, decision: SciSureWorkspaceDecision): SciSureWorkspaceFinding[] {
  return findings.map(finding => finding.findingId === findingId ? { ...finding, decision } : finding)
}

export function undecidedCount(findings: readonly Pick<SciSureWorkspaceFinding, 'decision'>[]): number {
  return findings.filter(finding => finding.decision === null).length
}

/** The server also refuses a draft with an undecided finding; this only keeps the control honest. */
export function canPrepareDraft(findings: readonly Pick<SciSureWorkspaceFinding, 'decision'>[]): boolean {
  return undecidedCount(findings) === 0
}

export type WritebackRequest = { nonce: string; bridgeSessionId: string; requestId: string; source: SourceLike; bundle: PreparedSciSureWriteback }

export function newRequestId(): string {
  const id = crypto.randomUUID()
  if (!ID.test(id)) throw new Error('Could not create a request ID.')
  return id
}

/** Only `create` is offered: the add-on answers `unsupported` to update, and sending it would imply otherwise. */
export function buildWritebackMessage({ nonce, bridgeSessionId, requestId, source, bundle }: WritebackRequest) {
  const identity = sourceIdentity(source)
  const message = {
    version: 2 as const,
    type: 'gcai.scisure.writeback' as const,
    nonce,
    bridgeSessionId,
    requestId,
    mode: 'create' as const,
    snapshot: { externalId: identity.externalId, ...(identity.externalVersionId ? { externalVersionId: identity.externalVersionId } : {}), selectionIds: identity.selectionIds },
    bundle,
  }
  if (!ID.test(requestId) || !identity.externalId || new TextEncoder().encode(JSON.stringify(message)).byteLength > MAX_SCISURE_WRITEBACK_BYTES) throw new Error('Writeback request is invalid or too large; nothing was sent.')
  return message
}

/** Accept only the add-on's reply to this exact request; everything else is ignored, never trusted. */
export function parseWritebackResult(data: unknown, expected: Pick<WritebackRequest, 'nonce' | 'bridgeSessionId' | 'requestId'>): SciSureWritebackResult | null {
  if (!data || typeof data !== 'object') return null
  const raw = data as Record<string, unknown>
  if (raw.version !== 2 || raw.type !== 'scisure.gcai.writeback-result') return null
  if (raw.nonce !== expected.nonce || raw.bridgeSessionId !== expected.bridgeSessionId || raw.requestId !== expected.requestId) return null
  if (typeof raw.status !== 'string' || !Object.hasOwn(RESULT_STATUSES, raw.status) || typeof raw.message !== 'string' || raw.message.length > 1024) return null
  if (raw.targetId !== undefined && (typeof raw.targetId !== 'string' || !ID.test(raw.targetId))) return null
  if (raw.targetKind !== undefined && raw.targetKind !== 'experiment' && raw.targetKind !== 'protocol') return null
  return {
    version: 2, type: 'scisure.gcai.writeback-result', nonce: expected.nonce, bridgeSessionId: expected.bridgeSessionId, requestId: expected.requestId,
    status: raw.status as SciSureWritebackResult['status'], message: raw.message,
    ...(raw.targetId !== undefined ? { targetId: raw.targetId as string } : {}),
    ...(raw.targetKind !== undefined ? { targetKind: raw.targetKind as 'experiment' | 'protocol' } : {}),
  }
}

/** Only a pre-mutation `failed` may be retried; every other status either mutated, may have mutated, or would repeat itself. */
export function canRetryWriteback(status: SciSureWritebackResult['status']): boolean {
  return status === 'failed'
}

export function writebackTarget(kind: 'experiment' | 'protocol' | 'protocol-step'): { noun: 'experiment' | 'protocol'; description: string } {
  return kind === 'experiment'
    ? { noun: 'experiment', description: 'Creates a new experiment containing the reviewed procedure and the private evidence appendix. The original experiment is not changed.' }
    : { noun: 'protocol', description: kind === 'protocol-step'
      ? 'Creates a new protocol containing only the selected procedure, labeled as a selected-content copy, plus the private evidence appendix. The original protocol is not changed.'
      : 'Creates a new protocol containing the reviewed procedure and the private evidence appendix. The original protocol is not changed.' }
}

export const UPDATE_UNAVAILABLE_NOTE = 'Updating the existing record is unavailable: SciSure documents no audit-preserving, version-checked update, so nothing is ever overwritten.'
