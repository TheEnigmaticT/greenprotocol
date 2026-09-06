import { PRINCIPLE_IDS, PRINCIPLES, CHANGE_CLASSES, type ChangeClass, type PrincipleID } from './principles'

export const EVALUATION_STATES = Object.freeze(['pending', 'evaluated', 'not-applicable', 'out-of-scope', 'not-evaluated', 'error'] as const)
export const FINDING_STATES = Object.freeze(['no-issue', 'supported', 'contradicted', 'insufficient', 'unresolved', 'candidate-only', 'rejected', 'unavailable'] as const)
export const AUTHORITY_STATES = Object.freeze(['no-edit', 'advisory', 'requires-human-design', 'approved-draft-edit'] as const)
export const LIFECYCLE_STATES = Object.freeze(['unselected', 'accepted', 'rejected', 'applied', 'superseded'] as const)
export interface DecisionBinding {
  readonly sourceHash: string
  readonly graphHash: string
  readonly claimIDs: readonly string[]
  readonly evidenceIDs: readonly string[]
}
export interface DurableDecision extends DecisionBinding {
  readonly schemaVersion: '2.0.0'
  readonly reasons: DecisionReasons
  readonly candidateHash: string | null
  readonly packetHash: string | null
  readonly auditReference: DurableAuditReference | null
  readonly id: string
  readonly principle: PrincipleID
  readonly evaluation: typeof EVALUATION_STATES[number]
  readonly finding: typeof FINDING_STATES[number]
  readonly authority: typeof AUTHORITY_STATES[number]
  readonly lifecycle: typeof LIFECYCLE_STATES[number]
}
export interface DecisionReasons { readonly version: '1.0.0'; readonly codes: readonly string[] }
/** Content-addressed external audit artifact. Store the audit and trusted context under auditHash.
 * Hash references are integrity bindings, never authentication or automatic edit authority. */
export interface DurableAuditReference extends DecisionBinding {
  readonly version: '1.0.0'
  readonly auditHash: string
  readonly contextHash: string
  readonly assessmentHash: string
  readonly candidateHash: string
  readonly packetHash: string
  readonly reviewerID: string
  readonly reviewerRole: 'applicability-auditor'
  readonly workerID: string
  readonly principle: PrincipleID
  readonly contractVersion: '1.0.0'
  readonly changeClass: ChangeClass
  readonly verdict: 'approve' | 'reject'
  readonly approvedDraftEdit: boolean
  readonly reasons: DecisionReasons
}
type Input = Pick<DurableDecision, 'id' | 'principle' | keyof DecisionBinding> & Partial<Pick<DurableDecision, 'evaluation' | 'finding' | 'authority' | 'lifecycle' | 'reasons' | 'candidateHash' | 'packetHash' | 'auditReference'>>
const hash = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)
const identifier = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x)
const ids = (x: unknown): x is string[] => Array.isArray(x) && x.every(identifier) && new Set(x).size === x.length
function validate(value: unknown): asserts value is DurableDecision {
  const d = value as DurableDecision | null
  if (!d || typeof d !== 'object' || d.schemaVersion !== '2.0.0' || !identifier(d.id) || !PRINCIPLE_IDS.includes(d.principle) || !hash(d.sourceHash) || !hash(d.graphHash) || !ids(d.claimIDs) || !ids(d.evidenceIDs) || !EVALUATION_STATES.includes(d.evaluation) || !FINDING_STATES.includes(d.finding) || !AUTHORITY_STATES.includes(d.authority) || !LIFECYCLE_STATES.includes(d.lifecycle)) throw new Error('Invalid decision record')
  const keys = ['schemaVersion', 'id', 'principle', 'sourceHash', 'graphHash', 'claimIDs', 'evidenceIDs', 'evaluation', 'finding', 'authority', 'lifecycle', 'reasons', 'candidateHash', 'packetHash', 'auditReference']
  if (Object.keys(d).some(k => !keys.includes(k))) throw new Error('Invalid decision record')
  const validReasons = (r: DecisionReasons) => !!r && r.version === '1.0.0' && ids(r.codes) && r.codes.length <= 128 && Object.keys(r).every(k => ['version', 'codes'].includes(k))
  if (!validReasons(d.reasons) || !(d.candidateHash === null || hash(d.candidateHash)) || !(d.packetHash === null || hash(d.packetHash)) || (d.candidateHash === null) !== (d.packetHash === null)) throw new Error('Invalid decision record')
  if (d.auditReference !== null) {
    const a = d.auditReference
    const keys = ['version', 'auditHash', 'contextHash', 'assessmentHash', 'candidateHash', 'packetHash', 'reviewerID', 'reviewerRole', 'workerID', 'principle', 'contractVersion', 'changeClass', 'verdict', 'approvedDraftEdit', 'reasons', 'sourceHash', 'graphHash', 'claimIDs', 'evidenceIDs']
    if (!a || Object.keys(a).some(k => !keys.includes(k)) || a.version !== '1.0.0' || !hash(a.auditHash) || !hash(a.contextHash) || !hash(a.assessmentHash) || !hash(a.candidateHash) || !hash(a.packetHash) || a.candidateHash !== d.candidateHash || a.packetHash !== d.packetHash || a.sourceHash !== d.sourceHash || a.graphHash !== d.graphHash || a.principle !== d.principle || a.contractVersion !== PRINCIPLES[d.principle].version || !CHANGE_CLASSES.includes(a.changeClass) || !identifier(a.reviewerID) || !identifier(a.workerID) || a.reviewerID === a.workerID || a.reviewerRole !== 'applicability-auditor' || !['approve', 'reject'].includes(a.verdict) || typeof a.approvedDraftEdit !== 'boolean' || !validReasons(a.reasons) || JSON.stringify(a.reasons) !== JSON.stringify(d.reasons) || !ids(a.claimIDs) || !ids(a.evidenceIDs) || JSON.stringify(a.claimIDs) !== JSON.stringify(d.claimIDs) || JSON.stringify(a.evidenceIDs) !== JSON.stringify(d.evidenceIDs) || a.approvedDraftEdit !== (a.verdict === 'approve' && a.reasons.codes.length === 0)) throw new Error('Invalid decision record')
  }
}
/** Storage is not authorization. Even inconsistent historical dimensions are preserved. */
export function createDecision(input: Input): DurableDecision {
  const d = { schemaVersion: '2.0.0' as const, reasons: { version: '1.0.0' as const, codes: ['unspecified'] }, candidateHash: null, packetHash: null, auditReference: null, evaluation: 'not-evaluated' as const, finding: 'unavailable' as const, authority: 'no-edit' as const, lifecycle: 'unselected' as const, ...input }
  validate(d)
  const copy = JSON.parse(JSON.stringify(d)) as DurableDecision
  const freeze = (v: unknown): void => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) } }
  freeze(copy)
  return copy
}
export function serializeDecision(d: DurableDecision): string { validate(d); return JSON.stringify(d) }
export function deserializeDecision(raw: string): DurableDecision {
  try { const d: unknown = JSON.parse(raw); validate(d); return createDecision(d) }
  catch { throw new Error('Invalid decision record') }
}
export function summarizeDecisions(rows: readonly DurableDecision[]) {
  let valid = true
  try { rows.forEach(validate) } catch { valid = false }
  const complete = valid && rows.length === PRINCIPLE_IDS.length && PRINCIPLE_IDS.every(id => rows.filter(d => d.principle === id).length === 1)
  const sameBinding = rows.every(d => d.sourceHash === rows[0]?.sourceHash && d.graphHash === rows[0]?.graphHash)
  return Object.freeze({ total: rows.length, allTwelveEvaluatedNoIssue: complete && sameBinding && rows.every(d => d.evaluation === 'evaluated' && d.finding === 'no-issue'), safetyCertified: false as const })
}
