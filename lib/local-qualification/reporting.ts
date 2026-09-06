import { PRINCIPLE_IDS } from './principles'

export const REQUIRED_REPORT_STAGES = Object.freeze(['extraction', 'source-inventory', 'claim-audit', ...PRINCIPLE_IDS, 'applicability', 'assembly', 'rescore', 'python-yield', 'python-smiles', 'python-p8', 'python-p11', 'acceptance'] as const)
export type ReportStage = typeof REQUIRED_REPORT_STAGES[number]
const STAGE_STATES = ['completed', 'not-run', 'unimplemented', 'blocked', 'failed', 'unavailable'] as const
const GATES = ['pass', 'fail', 'unknown'] as const
const SPLITS = ['calibration', 'previous-holdout', 'unclassified'] as const
export interface ReportManifest {
  readonly version: string
  readonly exhaustive: boolean
  readonly sources: readonly { readonly sourceHash: string; readonly split: typeof SPLITS[number] }[]
}
export interface CaseAcceptance {
  readonly sourceHash: string
  readonly stages: readonly { readonly stage: ReportStage; readonly status: typeof STAGE_STATES[number] }[]
  readonly preservation: typeof GATES[number]
  readonly evidenceApplicability: typeof GATES[number]
  readonly compatibility: typeof GATES[number]
  readonly usefulness: typeof GATES[number]
  readonly omissionReview: typeof GATES[number]
  readonly baseline: 'available' | 'unavailable'
  readonly usefulOutcomeCount: number
  readonly adjudicationHash: string | null
}
/** Pure safe projection of a trusted adjudicator's records, not an adjudicator.
 * A hash reference must be resolved/authenticated by the application before use.
 * Unknown cases stay in denominators; no chemistry prose leaves this boundary. */
export function createCohortReport(manifest: ReportManifest, results: readonly CaseAcceptance[]) {
  const invalid = (): never => { throw new Error('REPORT_INVALID') }
  const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
  if (!manifest || typeof manifest.version !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(manifest.version) || typeof manifest.exhaustive !== 'boolean' || !Array.isArray(manifest.sources) || manifest.sources.length > 10000 || !Array.isArray(results) || results.length > manifest.sources.length) invalid()
  const sources = new Map<string, typeof SPLITS[number]>()
  for (const row of manifest.sources) {
    if (!row || !hash(row.sourceHash) || !SPLITS.includes(row.split) || sources.has(row.sourceHash)) invalid()
    sources.set(row.sourceHash, row.split)
  }
  const bySource = new Map<string, CaseAcceptance>()
  for (const r of results) {
    if (!r || !sources.has(r.sourceHash) || bySource.has(r.sourceHash) || !Array.isArray(r.stages) || r.stages.length > REQUIRED_REPORT_STAGES.length || ![r.preservation, r.evidenceApplicability, r.compatibility, r.usefulness, r.omissionReview].every(g => GATES.includes(g)) || !['available', 'unavailable'].includes(r.baseline) || !Number.isSafeInteger(r.usefulOutcomeCount) || r.usefulOutcomeCount < 0 || !(r.adjudicationHash === null || hash(r.adjudicationHash))) invalid()
    const seen = new Set<ReportStage>()
    for (const s of r.stages) {
      if (!s || !REQUIRED_REPORT_STAGES.includes(s.stage) || !STAGE_STATES.includes(s.status) || seen.has(s.stage)) invalid()
      seen.add(s.stage)
    }
    bySource.set(r.sourceHash, r)
  }
  const cases = [...sources].sort(([a], [b]) => a.localeCompare(b)).map(([sourceHash, split], index) => {
    const r = bySource.get(sourceHash)
    const stages = Object.freeze(REQUIRED_REPORT_STAGES.map(stage => Object.freeze({ stage, status: r?.stages.find(s => s.stage === stage)?.status ?? 'not-run' as const })))
    const gates = Object.freeze({ preservation: r?.preservation ?? 'unknown', evidenceApplicability: r?.evidenceApplicability ?? 'unknown', compatibility: r?.compatibility ?? 'unknown', usefulness: r?.usefulness ?? 'unknown', omissionReview: r?.omissionReview ?? 'unknown' })
    const accepted = !!r && stages.every(s => s.status === 'completed') && Object.values(gates).every(g => g === 'pass') && r.baseline === 'available' && r.usefulOutcomeCount > 0 && r.adjudicationHash !== null
    return Object.freeze({ caseId: `case-${String(index + 1).padStart(4, '0')}`, sourceHash, split, stages, gates, baseline: r?.baseline ?? 'unavailable', usefulOutcomeCount: r?.usefulOutcomeCount ?? 0, adjudicationHash: r?.adjudicationHash ?? null, accepted })
  })
  const accepted = cases.filter(c => c.accepted).length
  return Object.freeze({ version: manifest.version, exhaustive: manifest.exhaustive, total: cases.length, accepted, cases: Object.freeze(cases), complete: manifest.exhaustive && cases.length > 0 && accepted === cases.length, scientificCertification: false as const })
}
