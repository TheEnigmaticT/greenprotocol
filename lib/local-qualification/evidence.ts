import { createHash } from 'node:crypto'
import { AUTHORITY_STATES, EVALUATION_STATES, FINDING_STATES, type DecisionBinding, type DurableDecision, type DurableAuditReference } from './decisions'
import { PRINCIPLES, PRINCIPLE_IDS, CHANGE_CLASSES, type PrincipleID, type ChangeClass } from './principles'

export const SUPPORT_KINDS = Object.freeze(['original-hazard', 'alternative-hazard', 'compatibility', 'outcome'] as const)
export type SupportKind = typeof SUPPORT_KINDS[number]
export interface EvidenceSnapshot { id: string; version: string; content: string; contentHash: string }
export interface EvidenceInput {
  id: string; version: '1.0.0'; sourceHash: string; sourceVersion: string
  /** UTF-16 offsets into the immutable snapshot, not byte offsets. */
  locator: { sourceID: string; start: number; end: number }
  excerpt: string; status: 'verified' | 'unverified' | 'unavailable'
  contradictions: readonly string[]; limitations: readonly string[]; claimIDs: readonly string[]
  supportKind: SupportKind; subjectID: string; conditionsHash: string
}
export interface EvidenceRecord extends Readonly<EvidenceInput> { readonly recordHash: string }
export interface Candidate extends DecisionBinding {
  principle: PrincipleID; contractVersion: '1.0.0'; changeClass: ChangeClass
  id: string; workerID: string; originalSubjectID: string; alternativeSubjectID: string; conditionsHash: string
  evaluation: DurableDecision['evaluation']; finding: DurableDecision['finding']; requestedAuthority: DurableDecision['authority']
}
export interface EvidencePacket extends DecisionBinding {
  readonly version: '1.0.0'; readonly candidateHash: string; readonly records: readonly EvidenceRecord[]; readonly packetHash: string
}
export interface ApplicabilityAudit {
  auditorID: string; role: string; candidateHash: string; graphHash: string; packetHash: string; verdict: 'approve' | 'reject'
  assessments: { evidenceID: string; claimID: string; supportKind: SupportKind; applicable: boolean }[]
}
/** TRUSTED SERVER INPUT: never populate actor/role or catalogs from worker/source text.
 * This pure validator checks supplied identity separation; authentication and semantic
 * applicability review must be implemented by the caller. Hashes are not signatures.
 */
export interface AuditContext {
  /** Integration-owned classification; never copy a worker's asserted class into policy. */
  policy: { candidateHash: string; principle: PrincipleID; contractVersion: '1.0.0'; changeClass: ChangeClass }
  actorID: string; role: string; sourceHash: string; graphHash: string
  registeredClaimIDs: readonly string[]; registeredEvidence: readonly EvidenceRecord[]
}
const isHash = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)
const isID = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x)
const isIDs = (x: unknown): x is string[] => Array.isArray(x) && x.every(isID) && new Set(x).size === x.length
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(v => typeof v === 'string' && v.trim().length > 0)
export function contentHash(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex') }
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(k => `${JSON.stringify(k)}:${canonical(object[k])}`).join(',')}}`
  }
  throw new Error('Invalid canonical data')
}
function digest(value: unknown) { return contentHash(canonical(value)) }
/** Exact bytes underlying evidence hashes; ordinary JSON insertion order differs. */
export function serializeEvidenceArtifact(value: unknown): string { return canonical(value) }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function validInput(r: EvidenceInput): boolean {
  return !!r && r.version === '1.0.0' && isID(r.id) && isHash(r.sourceHash) && isID(r.sourceVersion) && !!r.locator && isID(r.locator.sourceID) && Number.isInteger(r.locator.start) && Number.isInteger(r.locator.end) && r.locator.start >= 0 && r.locator.end > r.locator.start && typeof r.excerpt === 'string' && r.excerpt.trim().length > 0 && r.excerpt.length === r.locator.end - r.locator.start && ['verified', 'unverified', 'unavailable'].includes(r.status) && strings(r.contradictions) && strings(r.limitations) && isIDs(r.claimIDs) && r.claimIDs.length > 0 && SUPPORT_KINDS.includes(r.supportKind) && isID(r.subjectID) && isHash(r.conditionsHash)
}
function validRecord(record: EvidenceRecord): boolean {
  if (!validInput(record) || !isHash(record.recordHash)) return false
  const { recordHash, ...body } = record
  return digest(body) === recordHash
}
/** Verifies quotation provenance, NOT whether the quotation supports a chemical claim. */
export function createEvidenceRecord(snapshot: EvidenceSnapshot, input: EvidenceInput): EvidenceRecord {
  try {
    if (!validInput(input) || !isID(snapshot.id) || !isID(snapshot.version) || contentHash(snapshot.content) !== snapshot.contentHash || snapshot.contentHash !== input.sourceHash || snapshot.version !== input.sourceVersion || snapshot.id !== input.locator.sourceID || input.locator.end > snapshot.content.length || snapshot.content.slice(input.locator.start, input.locator.end) !== input.excerpt) throw new Error()
    const body = clone(input)
    return freeze({ ...body, recordHash: digest(body) })
  } catch { throw new Error('Invalid evidence record') }
}
export function hashCandidate(candidate: Candidate): string {
  try {
    if (!candidate || !PRINCIPLE_IDS.includes(candidate.principle) || candidate.contractVersion !== PRINCIPLES[candidate.principle].version || !CHANGE_CLASSES.includes(candidate.changeClass) || !isID(candidate.id) || !isID(candidate.workerID) || !isID(candidate.originalSubjectID) || !isID(candidate.alternativeSubjectID) || !isHash(candidate.sourceHash) || !isHash(candidate.graphHash) || !isHash(candidate.conditionsHash) || !isIDs(candidate.claimIDs) || !candidate.claimIDs.length || !isIDs(candidate.evidenceIDs) || !EVALUATION_STATES.includes(candidate.evaluation) || !FINDING_STATES.includes(candidate.finding) || !AUTHORITY_STATES.includes(candidate.requestedAuthority)) throw new Error()
    return digest(candidate)
  } catch { throw new Error('Invalid candidate') }
}
export function createEvidencePacket(candidate: Candidate, records: readonly EvidenceRecord[]): EvidencePacket {
  try {
    const candidateHash = hashCandidate(candidate)
    if (!Array.isArray(records) || !records.every(validRecord) || !records.every(r => r.claimIDs.every((id: string) => candidate.claimIDs.includes(id))) || !isIDs(records.map(r => r.id)) || records.length !== candidate.evidenceIDs.length || !records.every(r => candidate.evidenceIDs.includes(r.id))) throw new Error()
    const body = { version: '1.0.0' as const, candidateHash, sourceHash: candidate.sourceHash, graphHash: candidate.graphHash, claimIDs: [...candidate.claimIDs], evidenceIDs: [...candidate.evidenceIDs], records: clone(records) }
    return freeze({ ...body, packetHash: digest(body) })
  } catch { throw new Error('Invalid evidence packet') }
}
export interface AuditResult {
  readonly auditReference: DurableAuditReference | null
  readonly approvedDraftEdit: boolean; readonly mayApply: false; readonly reasons: readonly string[]
  readonly candidateHash: string | null; readonly packetHash: string | null
}
/** Conservative substitution gate. All four support kinds are required per claim.
 * No text instructions are executed; no source/evidence text is logged or returned.
 * Any unresolved limitation blocks approval. This is not a semantic chemistry auditor.
 */
export function auditApplicability(candidate: Candidate, packet: EvidencePacket, audit: ApplicabilityAudit, context: AuditContext): AuditResult {
  const reasons = new Set<string>()
  let auditReference: DurableAuditReference | null = null
  let candidateHash: string | null = null, packetHash: string | null = null
  try {
    candidateHash = hashCandidate(candidate)
    const rebuilt = createEvidencePacket(candidate, packet.records)
    packetHash = rebuilt.packetHash
    const { packetHash: declaredHash, ...body } = packet
    if (declaredHash !== digest(body) || declaredHash !== rebuilt.packetHash || packet.candidateHash !== candidateHash || packet.graphHash !== candidate.graphHash || packet.sourceHash !== candidate.sourceHash || context.graphHash !== candidate.graphHash || context.sourceHash !== candidate.sourceHash || audit.candidateHash !== candidateHash || audit.graphHash !== candidate.graphHash || audit.packetHash !== packetHash) reasons.add('binding-mismatch')
    if (!isID(context.actorID) || audit.auditorID !== context.actorID || audit.auditorID === candidate.workerID || audit.role !== 'applicability-auditor' || context.role !== 'applicability-auditor') reasons.add('independent-auditor-required')
    if (candidate.evaluation !== 'evaluated' || candidate.finding !== 'supported' || candidate.requestedAuthority !== 'approved-draft-edit') reasons.add('candidate-not-edit-eligible')
    const policy = context.policy
    if (!policy || policy.candidateHash !== candidateHash || policy.principle !== candidate.principle || policy.contractVersion !== candidate.contractVersion || policy.changeClass !== candidate.changeClass) reasons.add('policy-binding-mismatch')
    if (policy && (!PRINCIPLES[candidate.principle].draftChangeClasses.includes(policy.changeClass) || policy.changeClass !== 'bounded-substitution')) reasons.add('human-design-required')
    if (audit.verdict !== 'approve') reasons.add('audit-not-approved')
    if (!isIDs(context.registeredClaimIDs) || !candidate.claimIDs.every(id => context.registeredClaimIDs.includes(id))) reasons.add('unknown-claim')
    if (!isIDs(context.registeredEvidence.map(r => r.id)) || !context.registeredEvidence.every(validRecord)) reasons.add('invalid-evidence-catalog')
    const registered = new Map(context.registeredEvidence.map(r => [r.id, r]))
    for (const record of packet.records) {
      if (registered.get(record.id)?.recordHash !== record.recordHash) reasons.add('unknown-or-changed-evidence')
      if (!record.claimIDs.every(id => context.registeredClaimIDs.includes(id))) reasons.add('unknown-claim')
      if (record.status !== 'verified' || record.contradictions.length || record.limitations.length) reasons.add('evidence-not-resolved')
      const expectedSubject = record.supportKind === 'original-hazard' ? candidate.originalSubjectID : candidate.alternativeSubjectID
      if (record.subjectID !== expectedSubject || record.conditionsHash !== candidate.conditionsHash) reasons.add('evidence-context-mismatch')
    }
    const assessmentKeys = new Set<string>()
    for (const a of audit.assessments) {
      const record = packet.records.find(r => r.id === a.evidenceID)
      const key = `${a.evidenceID}/${a.claimID}`
      if (assessmentKeys.has(key)) reasons.add('duplicate-assessment')
      assessmentKeys.add(key)
      if (!record || !candidate.claimIDs.includes(a.claimID) || !record.claimIDs.includes(a.claimID) || a.supportKind !== record.supportKind || a.applicable !== true) reasons.add('invalid-applicability-assessment')
    }
    for (const record of packet.records) for (const claim of record.claimIDs) {
      if (!assessmentKeys.has(`${record.id}/${claim}`)) reasons.add('missing-pair-assessment')
    }
    for (const claim of candidate.claimIDs) for (const kind of SUPPORT_KINDS) {
      if (!packet.records.some(record => record.supportKind === kind && record.claimIDs.includes(claim) && audit.assessments.some(a => a.evidenceID === record.id && a.claimID === claim && a.supportKind === kind && a.applicable === true))) reasons.add('missing-applicable-support')
    }
    if (!packet.records.length) reasons.add('missing-evidence')
    // Only attach an authenticated-context reference when identity and all bindings match.
    // Caller persists {audit, contextCommitment} under auditHash before storing this reference.
    if (!['binding-mismatch', 'independent-auditor-required', 'policy-binding-mismatch'].some(r => reasons.has(r)) && ['approve', 'reject'].includes(audit.verdict)) {
      const contextCommitment = { actorID: context.actorID, role: context.role, sourceHash: context.sourceHash, graphHash: context.graphHash, policy, registeredClaimIDs: context.registeredClaimIDs, registeredEvidence: context.registeredEvidence.map(r => ({ id: r.id, recordHash: r.recordHash })) }
      auditReference = { version: '1.0.0', auditHash: digest({ audit, contextCommitment }), contextHash: digest(contextCommitment), assessmentHash: digest(audit.assessments), candidateHash, packetHash, sourceHash: candidate.sourceHash, graphHash: candidate.graphHash, claimIDs: [...candidate.claimIDs], evidenceIDs: [...candidate.evidenceIDs], reviewerID: context.actorID, reviewerRole: 'applicability-auditor', workerID: candidate.workerID, principle: candidate.principle, contractVersion: candidate.contractVersion, changeClass: candidate.changeClass, verdict: audit.verdict, approvedDraftEdit: reasons.size === 0, reasons: { version: '1.0.0', codes: [...reasons] } }
    }
  } catch { reasons.add('malformed-audit-input') }
  return freeze({ approvedDraftEdit: reasons.size === 0, mayApply: false as const, reasons: [...reasons], candidateHash, packetHash, auditReference })
}
