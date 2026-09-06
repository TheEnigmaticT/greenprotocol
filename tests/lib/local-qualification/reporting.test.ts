import { describe, expect, it } from 'vitest'
import { createCohortReport, REQUIRED_REPORT_STAGES, type CaseAcceptance } from '../../../lib/local-qualification/reporting'
const h = (n: string) => n.repeat(64)
const manifest = { version: '1', exhaustive: true, sources: [{ sourceHash: h('a'), split: 'calibration' as const }] }
function accepted(): CaseAcceptance {
  return { sourceHash: h('a'), stages: REQUIRED_REPORT_STAGES.map(stage => ({ stage, status: 'completed' as const })), preservation: 'pass', evidenceApplicability: 'pass', compatibility: 'pass', usefulness: 'pass', omissionReview: 'pass', baseline: 'available', usefulOutcomeCount: 1, adjudicationHash: h('b') }
}
describe('safe substantive cohort reporting', () => {
  it('emits a pending row for each missing case and never certifies an empty result', () => {
    const r = createCohortReport(manifest, [])
    expect(r.cases).toHaveLength(1)
    expect(r.cases[0].stages.every(s => s.status === 'not-run')).toBe(true)
    expect(r.accepted).toBe(0)
    expect(r.complete).toBe(false)
  })
  it('reconciles unique source hashes rather than trusting declared totals', () => {
    expect(() => createCohortReport({ ...manifest, sources: [...manifest.sources, ...manifest.sources] }, [])).toThrow('REPORT_INVALID')
    expect(() => createCohortReport(manifest, [accepted(), accepted()])).toThrow('REPORT_INVALID')
    expect(() => createCohortReport(manifest, [{ ...accepted(), sourceHash: h('c') }])).toThrow('REPORT_INVALID')
  })
  it('does not call non-exhaustive or empty cohorts complete', () => {
    expect(createCohortReport({ ...manifest, exhaustive: false }, [accepted()]).complete).toBe(false)
    expect(createCohortReport({ ...manifest, sources: [] }, []).complete).toBe(false)
  })
  it('requires all stages and substantive independent acceptance', () => {
    expect(createCohortReport(manifest, [accepted()]).complete).toBe(true)
    for (const key of ['preservation', 'evidenceApplicability', 'compatibility', 'usefulness', 'omissionReview'] as const) {
      expect(createCohortReport(manifest, [{ ...accepted(), [key]: 'unknown' }]).complete).toBe(false)
    }
    expect(createCohortReport(manifest, [{ ...accepted(), stages: accepted().stages.slice(1) }]).complete).toBe(false)
    expect(createCohortReport(manifest, [{ ...accepted(), adjudicationHash: null }]).complete).toBe(false)
  })
  it('does not count all-abstain or missing-baseline outputs as qualified', () => {
    expect(createCohortReport(manifest, [{ ...accepted(), usefulOutcomeCount: 0 }]).complete).toBe(false)
    expect(createCohortReport(manifest, [{ ...accepted(), baseline: 'unavailable' }]).complete).toBe(false)
  })
  it('preserves previous-holdout distinction and does not claim unseen science', () => {
    const r = createCohortReport({ ...manifest, sources: [{ sourceHash: h('a'), split: 'previous-holdout' }] }, [accepted()])
    expect(r.cases[0].split).toBe('previous-holdout')
    expect(r.scientificCertification).toBe(false)
  })
  it('drops private extensions and assigns safe synthetic identifiers', () => {
    const row = { ...accepted(), protocolText: 'PRIVATE_SENTINEL', sourceIdentifier: 'PRIVATE_SENTINEL' }
    const r = createCohortReport(manifest, [row])
    expect(JSON.stringify(r)).not.toContain('PRIVATE_SENTINEL')
    expect(r.cases[0].caseId).toBe('case-0001')
    expect(Object.isFrozen(r.cases[0].stages)).toBe(true)
  })
  it('rejects unknown or duplicate stages and unsafe enum strings without echo', () => {
    expect(() => createCohortReport(manifest, [{ ...accepted(), stages: [...accepted().stages, accepted().stages[0]] }])).toThrow('REPORT_INVALID')
    expect(() => createCohortReport(manifest, [{ ...accepted(), usefulness: 'PRIVATE_SENTINEL' as 'pass' }])).toThrow('REPORT_INVALID')
  })
})
