import { describe, expect, it } from 'vitest'
import { createSource, anchor } from '../../../lib/local-qualification/source'
import { createGraph } from '../../../lib/local-qualification/graph'
import { PRINCIPLES, PRINCIPLE_IDS, type PrincipleID } from '../../../lib/local-qualification/principles'
import { contentHash, createEvidenceRecord, createEvidencePacket, SUPPORT_KINDS, type AuditContext } from '../../../lib/local-qualification/evidence'
import { summarizeDecisions } from '../../../lib/local-qualification/decisions'
import { APPROVED_MODELS } from '../../../lib/local-qualification/provider'
// Dynamic loading makes the first RED an explicit missing-capability assertion.
const jobs = await import('../../../lib/local-qualification/principle-jobs').catch(() => ({})) as typeof import('../../../lib/local-qualification/principle-jobs')

function fixture(principle: PrincipleID = 'P5') {
  const source = createSource('Synthetic occurrence A. Synthetic dependency B.')
  const graph = createGraph(source, [{ category: 'material', status: 'observed', derivationIds: [], anchor: anchor(source, 0, 23) }])
  const factID = graph.facts[0].id
  const text = 'Synthetic test evidence only: not a chemistry claim.'
  const snapshot = { id: 'snapshot-1', version: 'v1', content: text, contentHash: contentHash(text) }
  const records = SUPPORT_KINDS.map((supportKind, i) => createEvidenceRecord(snapshot, {
    id: `ev-${i}`, version: '1.0.0', sourceHash: snapshot.contentHash, sourceVersion: snapshot.version,
    locator: { sourceID: snapshot.id, start: 0, end: text.length }, excerpt: text,
    status: 'verified', contradictions: [], limitations: [], claimIDs: [factID], supportKind,
    subjectID: supportKind === 'original-hazard' ? factID : 'alternative-1', conditionsHash: contentHash('synthetic conditions'),
  }))
  return { principle, source, graph, category: PRINCIPLES[principle].eligibleCategories[0], workerID: 'worker-1', factIDs: [factID],
    dependencyFacts: Object.fromEntries(PRINCIPLES[principle].requiredDependencies.map(key => [key, [factID]])),
    evidence: { approvalID: 'approved-fixture', snapshots: [snapshot], records } }
}
function output(input = fixture()) {
  return { version: '1.0.0', principle: input.principle, sourceHash: input.source.id.slice(7), graphHash: input.graph.id.slice(7),
    finding: 'candidate-only', action: 'compare',
    findings: [{ principle: input.principle, topic: PRINCIPLES[input.principle].requiredDependencies[0], status: Object.keys(input.dependencyFacts).length ? 'observation' : 'unknown', factIDs: [input.factIDs[0]], evidenceIDs: [],
      interpretation: 'Synthetic fixture occurrence requires contextual review.', constraint: 'Synthetic infrastructure fixture establishes no chemistry conclusion.', nextAction: 'Review the anchored occurrence against the required dependency evidence.' }],
    checks: PRINCIPLES[input.principle].requiredDependencies.map(key => ({ key, status: 'known', factIDs: input.factIDs, evidenceIDs: input.evidence.records.map(r => r.id) })),
    proposal: { originalSubjectID: input.factIDs[0], alternativeSubjectID: 'alternative-1', conditionsHash: contentHash('synthetic conditions'), changeClass: 'bounded-substitution' } }
}
function reviewer(input: ReturnType<typeof fixture>, result: ReturnType<typeof jobs.buildPrincipleJob> extends { parse: (...args: never[]) => infer R } ? R : never): AuditContext {
  const c = result.candidate!
  return { actorID: 'reviewer-1', role: 'applicability-auditor', sourceHash: c.sourceHash, graphHash: c.graphHash,
    registeredClaimIDs: input.factIDs, registeredEvidence: input.evidence.records,
    policy: { candidateHash: result.packet!.candidateHash, principle: c.principle, contractVersion: c.contractVersion, changeClass: c.changeClass } }
}

function omissionFixture(mode: 'unknown-fact' | 'observed-fact' | 'unknown-edge' | 'unresolved-reference') {
  const input = fixture(), original = input.graph.facts[0]
  const extra = { category: mode === 'unresolved-reference' ? 'unresolved-reference' as const : 'mixture' as const,
    status: mode === 'unknown-fact' ? 'unknown' as const : 'observed' as const, derivationIds: [], anchor: anchor(input.source, 24, input.source.bytes.length) }
  const base = createGraph(input.source, [original, extra])
  const other = base.facts.find(f => f.id !== original.id)!
  input.graph = createGraph(input.source, base.facts, mode === 'unknown-edge' || mode === 'unresolved-reference' ? [{ fromFactId: original.id, toFactId: other.id, relation: 'downstream-dependency', status: mode === 'unknown-edge' ? 'unknown' : 'observed', derivationIds: [], anchor: extra.anchor }] : [])
  if (mode === 'unknown-fact' || mode === 'observed-fact') {
    input.factIDs.push(other.id)
    input.dependencyFacts['mixture-composition'].push(other.id)
  }
  return input
}
function approvalOutput(input: ReturnType<typeof fixture>, worker: ReturnType<ReturnType<typeof jobs.buildPrincipleJob>['parse']>) {
  return { version: '1.0.0', candidateHash: worker.packet!.candidateHash, graphHash: worker.decision.graphHash, packetHash: worker.packet!.packetHash,
    verdict: 'approve', assessments: input.evidence.records.map(r => ({ evidenceID: r.id, claimID: r.claimIDs[0], supportKind: r.supportKind, applicable: true, factIDs: [r.claimIDs[0]] })) }
}

const scenarios: Record<PrincipleID, { text: string; interpretation: string; constraint: string }> = {
  P1: { text: 'Wash the isolated solid with 10 mL water. Wash again with 10 mL water. Recovered masses were not recorded.', interpretation: 'Two separate water wash occurrences contribute to the waste boundary.', constraint: 'Do not collapse the washes or calculate mass-based PMI without recovered masses and density provenance.' },
  P2: { text: 'Isolated yield was recorded. Product structure and balanced stoichiometry are unreported.', interpretation: 'The recorded isolated yield does not establish atom incorporation.', constraint: 'Obtain verified product structures and balanced stoichiometry before atom-economy calculation.' },
  P3: { text: 'Reagent contact occurs during open charging. A hazard endpoint is documented; replacement compatibility is untested.', interpretation: 'Open charging is an exposure-relevant operation, distinct from the documented hazard endpoint.', constraint: 'A lower-hazard replacement cannot be recommended as compatible from hazard data alone.' },
  P4: { text: 'Documented product A must retain coating adhesion. Product A has a documented irritation endpoint at the tested exposure.', interpretation: 'The product irritation endpoint must be considered alongside the required coating adhesion.', constraint: 'Preserve the documented adhesion requirement; no alternative molecule or safer product is established.' },
  P5: { text: 'Extract with solvent mixture. Mixture composition and ratio basis are unknown.', interpretation: 'The extraction occurrence has unresolved mixture composition and ratio basis.', constraint: 'Resolve composition before comparing phase behavior or approving an occurrence substitution.' },
  P6: { text: 'Baseline holds at 80 C for 1 h. Trial holds at 60 C for 4 h in the same jacketed vessel at ambient pressure. Energy was not metered.', interpretation: 'The trial lowers temperature but lengthens the hold duration relative to the baseline.', constraint: 'Temperature and duration do not establish energy savings without a measured energy boundary and comparable outcome.' },
  P7: { text: 'Feedstock identity is documented. Supplier lot origin and renewable fraction are unreported.', interpretation: 'Chemical identity alone does not distinguish bio-based from petrochemical sourcing.', constraint: 'Obtain lot-specific origin and fraction evidence; do not equate renewability with lower lifecycle impact.' },
  P8: { text: 'Protect the alcohol before selective conversion. Deprotect after the conversion; the route documents a selectivity requirement.', interpretation: 'The protection and deprotection steps serve a documented selectivity dependency.', constraint: 'Do not delete or reorder the protection sequence without demonstrated selectivity and outcome evidence.' },
  P9: { text: 'The metal-containing reagent is charged at one equivalent as a stoichiometric reactant. No turnover is documented.', interpretation: 'The assigned role and loading describe a stoichiometric reagent, not an established catalyst.', constraint: 'A metal name cannot establish catalysis; new catalytic routes require separate compatibility evidence.' },
  P10: { text: 'Product disappearance was measured in freshwater. Transformation products and ecotoxicity were not characterized.', interpretation: 'Freshwater disappearance does not establish harmless degradation products.', constraint: 'Retain the compartment boundary and request transformation-product and ecotoxicity evidence without inventing a pathway.' },
  P11: { text: 'Collect NMR after isolation to characterize the product. No measurement is linked to a control action during the run.', interpretation: 'Post-isolation NMR is characterization rather than intervention-capable process control.', constraint: 'Do not label the NMR step real-time prevention; identify timing and an actual intervention linkage before control redesign.' },
  P12: { text: 'A gas-evolving addition is performed in a confined vessel. Scale and vent capacity are unreported.', interpretation: 'Gas evolution and vessel confinement are interacting process constraints.', constraint: 'Missing scale and vent capacity prevent a process-safety conclusion; addition or equipment changes need human safety review.' },
}
function analyticalFixture(principle: PrincipleID, scenario = scenarios[principle]) {
  const input = fixture(principle)
  input.source = createSource(scenario.text)
  input.graph = createGraph(input.source, scenario.text.split('. ').map((part, i, parts) => {
    const start = i ? parts.slice(0, i).join('. ').length + 2 : 0
    return { category: principle === 'P5' ? 'mixture' as const : 'observation' as const, status: principle === 'P5' ? 'unknown' as const : 'observed' as const, derivationIds: [], anchor: anchor(input.source, start, start + part.length) }
  }))
  input.factIDs = input.graph.facts.map(f => f.id)
  input.dependencyFacts = Object.fromEntries(PRINCIPLES[principle].requiredDependencies.map(key => [key, input.factIDs]))
  const snapshot = { id: 'synthetic-analysis', version: 'v1', content: `Synthetic rubric, not scientific evidence. ${scenario.interpretation} ${scenario.constraint}`, contentHash: '' }
  snapshot.contentHash = contentHash(snapshot.content)
  input.evidence.snapshots = [snapshot]
  input.evidence.records = input.evidence.records.map(r => {
    const { recordHash: _hash, ...body } = r
    expect(_hash).toBeTruthy()
    return createEvidenceRecord(snapshot, { ...body, sourceHash: snapshot.contentHash, sourceVersion: snapshot.version, locator: { sourceID: snapshot.id, start: 0, end: snapshot.content.length }, excerpt: snapshot.content, claimIDs: input.factIDs, subjectID: input.factIDs[0] })
  })
  const raw = { ...output(input), finding: 'unresolved', action: 'human-design', proposal: null,
    findings: [{ principle, topic: PRINCIPLES[principle].requiredDependencies[0], status: principle === 'P5' ? 'unknown' : 'interpretation', factIDs: input.factIDs, evidenceIDs: input.evidence.records.map(r => r.id), interpretation: scenario.interpretation, constraint: scenario.constraint, nextAction: scenario.constraint }] }
  if (principle === 'P5') raw.checks = raw.checks.map(c => ({ ...c, status: 'unknown' }))
  return { input, raw }
}
describe('S2 bounded actual analytical findings', () => {
  it.each(PRINCIPLE_IDS)('%s returns a specific anchored finding and constraint, not its catalog', principle => {
    const { input, raw } = analyticalFixture(principle), job = jobs.buildPrincipleJob(input)
    expect(job.validate(raw)).toBe(true)
    const result = job.parse(raw)
    expect(result).toHaveProperty('findings', raw.findings)
    expect(result.decision.authority).toBe('requires-human-design')
    expect(result.candidate).toBeNull()
    expect(result).toHaveProperty('findings.0.interpretation', scenarios[principle].interpretation)
    expect(result).toHaveProperty('findings.0.constraint', scenarios[principle].constraint)
  })
  it('rejects catalog-only output without actual findings', () => {
    const { input, raw } = analyticalFixture('P6')
    const { findings: _findings, ...catalogOnly } = raw
    expect(_findings).toHaveLength(1)
    expect(jobs.buildPrincipleJob(input).validate(catalogOnly)).toBe(false)
  })
  it('bounds each finding and rejects cross-principle, fabricated, and unsupported references', () => {
    const { input, raw } = analyticalFixture('P6'), job = jobs.buildPrincipleJob(input)
    expect(job.validate(raw)).toBe(true)
    for (const change of [{ principle: 'P4' }, { topic: 'target-function' }, { interpretation: '' }, { constraint: 'x'.repeat(1201) }, { nextAction: '' }, { factIDs: [] }, { factIDs: ['fabricated'] }, { evidenceIDs: ['invented-citation'] }, { evidenceIDs: [] }, { citation: 'fabricated DOI' }, { rewrite: 'new protocol' }]) {
      expect(job.validate({ ...raw, findings: [{ ...raw.findings[0], ...change }] })).toBe(false)
    }
    expect(job.validate({ ...raw, findings: [] })).toBe(false)
    expect(job.validate({ ...raw, findings: Array(17).fill(raw.findings[0]) })).toBe(false)
  })
  it('cannot promote an unknown mixture finding to an evidence interpretation', () => {
    const { input, raw } = analyticalFixture('P5'), job = jobs.buildPrincipleJob(input)
    expect(job.validate(raw)).toBe(true)
    expect(job.validate({ ...raw, findings: [{ ...raw.findings[0], status: 'interpretation' }] })).toBe(false)
  })
  it('retains uncertain/contradicted findings instead of allowing top-level support or no-issue', () => {
    const input = fixture(), raw = output(input), job = jobs.buildPrincipleJob(input)
    for (const status of ['unknown', 'contradicted']) {
      const findings = [{ ...raw.findings[0], status }]
      expect(job.validate({ ...raw, findings, finding: 'supported' })).toBe(false)
      expect(job.validate({ ...raw, findings, finding: 'no-issue', action: 'none', proposal: null })).toBe(false)
      expect(job.parse({ ...raw, findings, finding: 'unresolved' }).findings[0].status).toBe(status)
    }
  })
  it('preserves conflicting evidence on a contradicted finding, never a clean interpretation', () => {
    const { input, raw } = analyticalFixture('P10')
    const { recordHash, ...body } = input.evidence.records[0]
    expect(recordHash).toBeTruthy()
    input.evidence.records[0] = createEvidenceRecord(input.evidence.snapshots[0], { ...body, contradictions: ['Synthetic conflicting compartment endpoint'] })
    const job = jobs.buildPrincipleJob(input)
    expect(job.validate(raw)).toBe(false)
    expect(job.parse({ ...raw, findings: [{ ...raw.findings[0], status: 'contradicted' }] }).findings[0].evidenceIDs).toEqual(raw.findings[0].evidenceIDs)
  })
  it('distinguishes intervention-linked monitoring from the post-run NMR fixture', () => {
    const scenario = { text: 'An in-process temperature reading triggers a documented pause in the feed. Sensor response time has not been validated.', interpretation: 'The temperature reading has an explicit feed-pause intervention linkage, unlike post-run NMR.', constraint: 'Validate sensor response time before claiming preventive control performance.' }
    const { input, raw } = analyticalFixture('P11', scenario)
    const result = jobs.buildPrincipleJob(input).parse(raw)
    expect(result.findings[0].interpretation).toBe(scenario.interpretation)
    expect(result.findings[0].interpretation).not.toBe(scenarios.P11.interpretation)
    expect(result.findings[0].constraint).toBe(scenario.constraint)
    expect(result.decision.authority).toBe('requires-human-design')
  })
})

describe('S1 independent required dependency coverage', () => {
  it.each(['unknown-fact', 'observed-fact', 'unknown-edge', 'unresolved-reference'] as const)('rejects supported/no-issue when worker omits %s', mode => {
    const input = omissionFixture(mode), raw = output(input), original = input.evidence.records[0].claimIDs[0]
    raw.checks = raw.checks.map(c => ({ ...c, factIDs: [original] }))
    const job = jobs.buildPrincipleJob(input)
    expect(job.validate({ ...raw, finding: 'supported' })).toBe(false)
    expect(job.validate({ ...raw, finding: 'no-issue', action: 'none', proposal: null })).toBe(false)
  })
  it.each(['unknown-fact', 'observed-fact', 'unknown-edge', 'unresolved-reference'] as const)('independently rejects audit approval of forged worker completeness: %s', mode => {
    const input = omissionFixture(mode), raw = output(input), original = input.evidence.records[0].claimIDs[0]
    raw.checks = raw.checks.map(c => ({ ...c, status: 'unknown', factIDs: [original] }))
    const parsed = jobs.buildPrincipleJob(input).parse(raw)
    const candidate = { ...parsed.candidate!, evaluation: 'evaluated' as const, finding: 'supported' as const, requestedAuthority: 'approved-draft-edit' as const }
    const worker = { ...parsed, candidate, packet: createEvidencePacket(candidate, input.evidence.records) }
    const job = jobs.buildApplicabilityJob(input, worker, reviewer(input, worker))
    expect(job.validate(approvalOutput(input, worker))).toBe(false)
  })
  it('retains exact reviewer fact references in a bound companion audit record', () => {
    const input = fixture(), worker = jobs.buildPrincipleJob(input).parse({ ...output(input), finding: 'supported' })
    const reviewed = jobs.buildApplicabilityJob(input, worker, reviewer(input, worker)).parse(approvalOutput(input, worker))
    expect(reviewed).toHaveProperty('grounding.version', 'applicability-grounding/v1')
    expect(reviewed).toHaveProperty('grounding.graphHash', worker.decision.graphHash)
    expect(reviewed).toHaveProperty('grounding.candidateHash', worker.packet!.candidateHash)
    expect(reviewed).toHaveProperty('grounding.assessments', approvalOutput(input, worker).assessments)
  })
})

describe('bounded principle jobs — synthetic contract tests, not scientific validation', () => {
  it('exports concrete builders and injected execution', () => {
    for (const name of ['buildPrincipleJob', 'runPrincipleJob', 'buildApplicabilityJob']) expect(jobs).toHaveProperty(name, expect.any(Function))
  })
  it.each(PRINCIPLE_IDS)('%s has a distinct scoped request and strict complete dependency checks', id => {
    const input = fixture(id), job = jobs.buildPrincipleJob(input), raw = output(input)
    expect(job.principle).toBe(id)
    expect(job.role).toBe('principle-worker')
    expect(job.messages[0].content).toContain(PRINCIPLES[id].name)
    for (const rule of PRINCIPLES[id].outputRestrictions) expect(job.messages[0].content).toContain(rule)
    expect(job.output.schema.additionalProperties).toBe(false)
    if (['P2', 'P4', 'P6', 'P8', 'P10', 'P11', 'P12'].includes(id)) raw.action = 'human-design'
    const result = job.parse(raw)
    expect(result.decision.principle).toBe(id)
    expect(result.decision.finding).toBe('candidate-only')
    expect(result.decision.authority).not.toBe('approved-draft-edit')
    expect(result.decision.lifecycle).toBe('unselected')
    expect(result.candidate).not.toBeNull()
    expect(result.action.code).not.toBe('compare') // concrete principle-specific action
    expect(job.validate({ ...raw, checks: raw.checks.slice(1) })).toBe(false)
    expect(job.validate({ ...raw, checks: [...raw.checks, raw.checks[0]] })).toBe(false)
    expect(job.validate({ ...raw, principle: 'P99' })).toBe(false)
  })
  it.each(['citation', 'rewrite', 'authority', 'score', 'retrieval', 'workerApproval'])('rejects generated/extra %s fields', field => {
    const job = jobs.buildPrincipleJob(fixture())
    expect(job.validate({ ...output(), [field]: 'invented' })).toBe(false)
    expect(job.validate({ ...output(), proposal: { ...output().proposal, [field]: 'invented' } })).toBe(false)
  })
  it('rejects unbound facts, evidence, stale bindings, and unsupported status semantics', () => {
    const job = jobs.buildPrincipleJob(fixture()), raw = output()
    expect(job.validate({ ...raw, graphHash: contentHash('stale') })).toBe(false)
    for (const change of [{ factIDs: ['invented'] }, { evidenceIDs: ['invented'] }, { status: 'known', factIDs: [] }, { status: 'maybe' }, { evidenceIDs: ['ev-0', 'ev-0'] }]) {
      expect(job.validate({ ...raw, checks: raw.checks.map((c, i) => i ? c : { ...c, ...change }) })).toBe(false)
    }
    expect(job.validate({ ...raw, finding: 'supported', checks: raw.checks.map(c => ({ ...c, status: 'unknown' })) })).toBe(false)
    expect(job.validate({ ...raw, proposal: { ...raw.proposal, alternativeSubjectID: 'invented-molecule' } })).toBe(false)
    expect(job.validate({ ...raw, proposal: { ...raw.proposal, conditionsHash: contentHash('invented') } })).toBe(false)
  })
  it('preserves contradictory, unavailable, rejected and human-design states without escalation', () => {
    for (const finding of ['contradicted', 'rejected', 'candidate-only']) {
      const result = jobs.buildPrincipleJob(fixture()).parse({ ...output(), finding })
      expect(result.decision.finding).toBe(finding)
      expect(result.decision.authority).not.toBe('approved-draft-edit')
    }
    for (const id of ['P4', 'P10'] as const) {
      const input = fixture(id), raw = { ...output(input), action: 'human-design' }
      const job = jobs.buildPrincipleJob(input)
      expect(job.parse(raw).decision.authority).toBe('requires-human-design')
      expect(job.validate({ ...raw, action: 'compare' })).toBe(false)
    }
    const input = fixture(); input.evidence.records = []; input.evidence.snapshots = []; input.dependencyFacts = {}
    const raw = { ...output(input), finding: 'unavailable', action: 'investigate', proposal: null,
      checks: PRINCIPLES.P5.requiredDependencies.map(key => ({ key, status: 'unknown', factIDs: [], evidenceIDs: [] })) }
    const result = jobs.buildPrincipleJob(input).parse(raw)
    expect(result.decision.finding).toBe('unavailable')
    expect(result.decision.evaluation).toBe('not-evaluated')
    expect(result.decision.authority).toBe('no-edit')
  })
  it('does not let hazard-only evidence establish supported substitution', () => {
    const input = fixture(); input.evidence.records = input.evidence.records.slice(0, 2)
    const job = jobs.buildPrincipleJob(input), raw = output(input)
    expect(job.validate(raw)).toBe(true)
    expect(job.validate({ ...raw, finding: 'supported' })).toBe(false)
  })
  it('fails closed on unknown mixture/dependency facts, contradiction or unapproved evidence input', () => {
    const input = fixture()
    expect(() => jobs.buildPrincipleJob({ ...input, evidence: { ...input.evidence, approvalID: '' } })).toThrow()
    expect(() => jobs.buildPrincipleJob({ ...input, factIDs: ['missing'] })).toThrow()
    const bad = structuredClone(input); bad.evidence.records[0] = { ...bad.evidence.records[0], excerpt: 'forged' }
    expect(() => jobs.buildPrincipleJob(bad)).toThrow()
    const unknown = fixture(); unknown.dependencyFacts['mixture-composition'] = []
    expect(jobs.buildPrincipleJob(unknown).validate({ ...output(unknown), finding: 'supported' })).toBe(false)
    const contradictory = fixture()
    const { recordHash, ...r } = contradictory.evidence.records[0]
    expect(recordHash).toMatch(/^[a-f0-9]{64}$/)
    contradictory.evidence.records[0] = createEvidenceRecord(contradictory.evidence.snapshots[0], { ...r, contradictions: ['conflicting frozen result'] })
    const job = jobs.buildPrincipleJob(contradictory), raw = output(contradictory)
    expect(job.validate({ ...raw, finding: 'supported' })).toBe(false)
    expect(job.validate({ ...raw, finding: 'no-issue', proposal: null, action: 'none' })).toBe(false)
    expect(job.parse({ ...raw, finding: 'contradicted' }).decision.finding).toBe('contradicted')
  })
  it('bounds input/output and owns a frozen snapshot across transport yield', async () => {
    const input = fixture(), raw = output(input), job = jobs.buildPrincipleJob(input)
    input.evidence.records = []
    expect(job.validate(raw)).toBe(true)
    expect(job.validate('not json')).toBe(false)
    expect(job.validate({ ...raw, checks: Array(200).fill(raw.checks[0]) })).toBe(false)
    expect(() => jobs.buildPrincipleJob({ ...fixture(), factIDs: Array(300).fill('x') })).toThrow()
    const result = await jobs.runPrincipleJob(fixture(), { model: APPROVED_MODELS[0], execute: async request => {
      expect(request.messages[0].content).toContain('untrusted')
      return raw
    } })
    expect(result.decision.finding).toBe('candidate-only')
  })
  it('never calls forbidden models and never converts failed jobs into all-twelve success', async () => {
    let calls = 0
    await expect(jobs.runPrincipleJob(fixture(), { model: 'unapproved/model', execute: async () => { calls++; return output() } })).rejects.toThrow()
    expect(calls).toBe(0)
    const rows = []
    for (const principle of PRINCIPLE_IDS) {
      const input = fixture(principle)
      const result = await jobs.runPrincipleJob(input, { model: APPROVED_MODELS[0], execute: async () => { throw new Error('private chemistry must not leak') } })
      expect(result.decision.evaluation).toBe('error')
      expect(result.decision.finding).toBe('unavailable')
      expect(JSON.stringify(result)).not.toContain('private chemistry')
      rows.push(result.decision)
    }
    expect(summarizeDecisions(rows).allTwelveEvaluatedNoIssue).toBe(false)
  })
  it.each(PRINCIPLE_IDS)('%s retains occurrence-specific evidence and constraints, not just generic advisory codes', principle => {
    const input = fixture(principle)
    const raw = output(input)
    if (['P2', 'P4', 'P6', 'P8', 'P10', 'P11', 'P12'].includes(principle)) raw.action = 'human-design'
    const result = jobs.buildPrincipleJob(input).parse(raw)
    expect(result.grounding.facts).toEqual(input.graph.facts)
    expect(result.grounding.evidence).toEqual(input.evidence.records)
    expect(result.grounding.evidence[0].excerpt).toBe(input.evidence.snapshots[0].content)
    expect(result.candidate!.alternativeSubjectID).toBe('alternative-1')
    expect(Object.isFrozen(result.grounding.evidence)).toBe(true)
  })
  it.each(PRINCIPLE_IDS)('%s fails closed on each missing scoped dependency instead of inventing chemistry', principle => {
    const input = fixture(principle), raw = output(input)
    if (['P2', 'P4', 'P6', 'P8', 'P10', 'P11', 'P12'].includes(principle)) raw.action = 'human-design'
    const job = jobs.buildPrincipleJob(input)
    for (const key of PRINCIPLES[principle].requiredDependencies) {
      const missing = { ...raw, checks: raw.checks.map(c => c.key === key ? { ...c, status: 'unknown' } : c) }
      expect(job.validate({ ...missing, finding: 'supported' })).toBe(false)
      expect(job.parse({ ...missing, finding: 'candidate-only' }).decision.evaluation).toBe('not-evaluated')
    }
  })
  it('retains contradictory/unavailable frozen evidence with grounded human research advice', () => {
    const input = fixture('P10')
    const { recordHash, ...record } = input.evidence.records[0]
    expect(recordHash).toBeTruthy()
    input.evidence.records[0] = createEvidenceRecord(input.evidence.snapshots[0], { ...record, status: 'unavailable', limitations: ['Synthetic missing compartment'], contradictions: ['Synthetic conflicting endpoint'] })
    const raw = { ...output(input), finding: 'unresolved', action: 'human-design', proposal: null }
    const result = jobs.buildPrincipleJob(input).parse(raw)
    expect(result.decision.finding).toBe('unresolved')
    expect(result.decision.authority).toBe('requires-human-design')
    expect(result.grounding.evidence[0].status).toBe('unavailable')
    expect(result.grounding.evidence[0].limitations).toEqual(['Synthetic missing compartment'])
    expect(result.grounding.evidence[0].contradictions).toEqual(['Synthetic conflicting endpoint'])
  })
  it('rejects redesign proposals disguised as bounded candidate approval', () => {
    const input = fixture(), raw = output(input), job = jobs.buildPrincipleJob(input)
    for (const changeClass of ['molecular-redesign', 'route-redesign', 'product-redesign', 'process-safety-redesign']) {
      expect(job.validate({ ...raw, proposal: { ...raw.proposal, changeClass } })).toBe(false)
      const result = job.parse({ ...raw, action: 'human-design', proposal: { ...raw.proposal, changeClass } })
      expect(result.decision.authority).toBe('requires-human-design')
      expect(result.candidate!.requestedAuthority).toBe('requires-human-design')
    }
  })
  it('independent applicability reviewer cannot reuse worker identity or verdict authority', () => {
    const input = fixture(), worker = jobs.buildPrincipleJob(input).parse({ ...output(input), finding: 'supported' }), context = reviewer(input, worker)
    expect(worker.decision.authority).toBe('advisory')
    const review = jobs.buildApplicabilityJob(input, worker, context)
    expect(review.role).toBe('applicability-auditor')
    expect(review.messages[0].content).toContain('independent')
    expect(review.messages[1].content).not.toContain('requestedAuthority')
    expect(review.messages[1].content).not.toContain('"finding"')
    const raw = { version: '1.0.0', candidateHash: worker.packet!.candidateHash, graphHash: worker.decision.graphHash, packetHash: worker.packet!.packetHash,
      verdict: 'approve', assessments: input.evidence.records.map(r => ({ evidenceID: r.id, claimID: input.factIDs[0], supportKind: r.supportKind, applicable: true, factIDs: input.factIDs })) }
    expect(review.parse(raw).result.approvedDraftEdit).toBe(true)
    expect(review.parse(raw).result.mayApply).toBe(false)
    expect(review.validate({ ...raw, assessments: raw.assessments.slice(1) })).toBe(false)
    expect(review.validate({ ...raw, assessments: [...raw.assessments, raw.assessments[0]] })).toBe(false)
    expect(review.validate({ ...raw, assessments: raw.assessments.map(a => ({ ...a, factIDs: ['invented'] })) })).toBe(false)
    expect(review.parse({ ...raw, verdict: 'reject' }).result.approvedDraftEdit).toBe(false)
    expect(() => jobs.buildApplicabilityJob(input, worker, { ...context, actorID: input.workerID })).toThrow()
  })
})
