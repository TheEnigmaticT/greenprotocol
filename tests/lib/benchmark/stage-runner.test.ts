import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { BenchmarkProvider, JsonCompletionRequest } from '@/lib/benchmark/provider'
import { runBenchmarkStages, type BenchmarkRunInput } from '@/lib/benchmark/stage-runner'
import type { LiteratureEvidenceMatch } from '@/lib/types'

const parsed = {
  protocolTitle: 'Test esterification',
  chemistrySubdomain: 'organic synthesis',
  steps: [{ stepNumber: 1, description: 'Mix reagents', chemicals: [{ name: 'Acetone', role: 'solvent', quantity: '10 mL', quantityMl: 10, quantityKg: null }], conditions: { temperature: '20 C', duration: '1 h', atmosphere: 'air' } }],
}
const recommendation = (principleNumber = 1) => ({
  stepNumber: 1, principleNumbers: [principleNumber], principleNames: [`Principle ${principleNumber}`], severity: 'medium' as const,
  original: { chemical: 'Acetone', issue: 'volatile solvent' }, alternative: { chemical: 'Water', rationale: 'safer', yieldImpact: 'unknown', caveats: '', evidenceBasis: 'fixture' },
  confidenceLevel: 'medium' as const,
})
const evidence: LiteratureEvidenceMatch = { id: 'e1', sourceDocumentId: 'd1', title: 'Frozen paper', pageStart: 1, pageEnd: 2, quote: 'Water works', candidateStatus: 'adjudicated', similarity: 0.9 }

function providerFor(responses: unknown[], calls: JsonCompletionRequest[] = []): BenchmarkProvider {
  return { completeJson: vi.fn(async <T>(request: JsonCompletionRequest) => { calls.push(request); const data = responses.shift(); if (data instanceof Error) throw data; return { data: data as T, usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, provider: 'fake', model: request.model, stage: request.stage, costUsd: 0.01, generationId: `g-${request.stage}` } }) as BenchmarkProvider['completeJson'] }
}
function input(provider: BenchmarkProvider, overrides: Partial<BenchmarkRunInput> = {}): BenchmarkRunInput {
  return { protocolText: 'Mix acetone.', model: 'fake-model', provider, frozenLiteratureMatches: [evidence], analysisMetadata: { generatedAt: '2026-01-02T03:04:05.000Z', gcaiVersion: '0.7.1', methodologyVersion: 'waste-v0' }, now: () => 1000, ...overrides }
}

describe('benchmark-only stage runner', () => {
  it('runs parse, all 12 principles, frozen evidence re-evaluation, and assembly in order', async () => {
    const calls: JsonCompletionRequest[] = []
    const provider = providerFor([parsed, ...Array.from({ length: 12 }, (_, i) => ({ principleNumber: i + 1, recommendations: [recommendation(i + 1)] })), { action: 'confirm', revisedConfidence: 'high', revisedRationale: 'supported', evidenceAssessment: { supportsOriginalIssue: true, supportsAlternative: true, contextMatch: 'strong', quantitativeData: false }, concerns: [] }, { revisedProtocol: 'revised', overallAssessment: { greenPrinciplesViolated: [1], mostImpactfulChange: 'Water', experimentalValidationNeeded: true, disclaimer: 'fixture' } }], calls)
    const result = await runBenchmarkStages(input(provider))
    expect(calls.map(c => c.stage)).toEqual(['parse', ...Array.from({ length: 12 }, (_, i) => `principle-${i + 1}`), 'reevaluate-1-1', 'assemble'])
    expect(result.parsed).toEqual(parsed)
    expect(result.recommendations).toHaveLength(1)
    expect(result.assembled!.revisedProtocol).toBe('revised')
    expect(result.telemetry).toHaveLength(15)
    expect(result.telemetry.every(t => t.provider === 'fake' && t.model === 'fake-model' && t.latencyMs === 0 && t.usage?.totalTokens === 3 && t.costUsd === 0.01 && t.generationId)).toBe(true)
  })

  it('passes only injected frozen evidence to reevaluation and never invokes network', async () => {
    const calls: JsonCompletionRequest[] = []
    const provider = providerFor([parsed, ...Array.from({ length: 12 }, (_, i) => ({ principleNumber: i + 1, recommendations: i === 0 ? [recommendation()] : [] })), { action: 'downgrade', revisedConfidence: 'low', revisedRationale: 'limited', evidenceAssessment: { supportsOriginalIssue: false, supportsAlternative: false, contextMatch: 'none', quantitativeData: false }, concerns: ['weak'] }, { revisedProtocol: 'same', overallAssessment: { greenPrinciplesViolated: [1], mostImpactfulChange: 'none', experimentalValidationNeeded: true, disclaimer: 'x' } }], calls)
    const result = await runBenchmarkStages(input(provider))
    const reevaluateCall = calls.find(c => c.stage.startsWith('reevaluate-'))!
    expect(reevaluateCall.system).toContain('Frozen paper')
    expect(reevaluateCall.system).not.toContain('database')
    expect(result.telemetry.find(t => t.stage.startsWith('reevaluate-'))?.shapeMetadata).toEqual(expect.objectContaining({ topLevelKeys: expect.any(Array), outputHash: expect.any(String) }))
    expect(JSON.stringify(result.telemetry)).not.toContain('limited')
  })

  it('isolates principle failures and records sanitized errors', async () => {
    const calls: JsonCompletionRequest[] = []
    const responses = [parsed, new Error('secret api key and protocol'), ...Array.from({ length: 11 }, (_, i) => ({ principleNumber: i + 2, recommendations: [recommendation(i + 2)] })), { action: 'suppress', revisedConfidence: 'low', revisedRationale: 'no', evidenceAssessment: { supportsOriginalIssue: false, supportsAlternative: false, contextMatch: 'none', quantitativeData: false }, concerns: [], suppressionReason: 'no' }, { revisedProtocol: 'revised', overallAssessment: { greenPrinciplesViolated: [], mostImpactfulChange: 'none', experimentalValidationNeeded: false, disclaimer: 'x' } }]
    const result = await runBenchmarkStages(input(providerFor(responses, calls)))
    expect(result.recommendations).toHaveLength(0)
    const failed = result.telemetry.find(t => t.stage === 'principle-1')!
    expect(failed.error?.message).toBe('Benchmark provider request failed')
    expect(failed.error?.message).not.toContain('secret')
    expect(result.assembled!.revisedProtocol).toBe('revised')
  })

  it('contains no persistence or production-pipeline integration', () => {
    const source = readFileSync('lib/benchmark/stage-runner.ts', 'utf8')
    expect(source).not.toMatch(/supabase|logLLMTrace|logDedupTrace|app\/api\/analyze|searchLiteratureEvidence/)
  })

  it('attaches frozen citations, derives parity metadata, benefit, tier, and ranking', async () => {
    const rec1 = { ...recommendation(1), severity: 'low' as const }
    const rec2 = { ...recommendation(3), severity: 'high' as const, alternative: { ...recommendation(3).alternative, chemical: 'Ethanol' } }
    const responses = [parsed, ...Array.from({ length: 12 }, (_, i) => ({ principleNumber: i + 1, recommendations: i === 0 ? [rec1] : i === 2 ? [rec2] : [] })), { action: 'confirm', revisedConfidence: 'medium', revisedRationale: 'supported', evidenceAssessment: { supportsOriginalIssue: true, supportsAlternative: true, contextMatch: 'strong', quantitativeData: false }, concerns: [] }, { revisedProtocol: 'revised', overallAssessment: { greenPrinciplesViolated: [1], mostImpactfulChange: 'x', experimentalValidationNeeded: true, disclaimer: 'x' } }]
    const result = await runBenchmarkStages(input(providerFor(responses), { frozenLiteratureMatches: [evidence] }))
    expect(result.recommendations[0]).toEqual(expect.objectContaining({ severity: 'high', evidenceTier: 'sourced', primaryBenefit: 'Reduces direct chemical waste', citationMetadata: { gcaiVersion: '0.7.1', generatedAt: '2026-01-02T03:04:05.000Z' } }))
    expect(result.recommendations[0].evidence?.citations[0].source_id).toBe('e1')
  })

  it('merges distinct alternatives into rationale and sorts by step then severity', async () => {
    const first = recommendation(1)
    const second = { ...recommendation(2), stepNumber: 1, severity: 'high' as const, alternative: { ...recommendation(2).alternative, chemical: 'Ethanol' } }
    const responses = [parsed, { principleNumber: 1, recommendations: [first] }, { principleNumber: 2, recommendations: [second] }, ...Array.from({ length: 10 }, (_, i) => ({ principleNumber: i + 3, recommendations: [] })), new Error('reevaluation unavailable'), { revisedProtocol: 'r', overallAssessment: { greenPrinciplesViolated: [1], mostImpactfulChange: 'x', experimentalValidationNeeded: true, disclaimer: 'x' } }]
    const result = await runBenchmarkStages(input(providerFor(responses), { frozenLiteratureMatches: [] }))
    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0].severity).toBe('high')
    expect(result.recommendations[0].alternative.rationale).toContain('Also consider: Water.')
  })

  it('aborts with a sanitized error when every principle call fails', async () => {
    const resultPromise = runBenchmarkStages(input(providerFor([parsed, ...Array.from({ length: 12 }, () => new Error('secret'))])))
    await expect(resultPromise).rejects.toThrow('Benchmark principle evaluation failed')
    await expect(resultPromise).rejects.not.toThrow('secret')
  })

  it('sanitizes invalid parse and assembly results, and retains originals on invalid reevaluation', async () => {
    await expect(runBenchmarkStages(input(providerFor([{}])))).rejects.toThrow('Benchmark parse stage failed')
    const responses = [parsed, ...Array.from({ length: 12 }, (_, i) => ({ principleNumber: i + 1, recommendations: i === 0 ? [recommendation()] : [] })), {}, { revisedProtocol: 'r', overallAssessment: { greenPrinciplesViolated: [1], mostImpactfulChange: 'x', experimentalValidationNeeded: true, disclaimer: 'x' } }]
    const result = await runBenchmarkStages(input(providerFor([...responses])))
    expect(result.recommendations).toHaveLength(1)
    expect(result.telemetry.find(t => t.stage.startsWith('reevaluate-'))?.error?.message).toBe('Invalid benchmark stage result')
    expect(result.assembled?.revisedProtocol).toBe('r')
    await expect(runBenchmarkStages(input(providerFor([...responses.slice(0, -2), {}, {}])))).rejects.toThrow('Benchmark assembly stage failed')
  })

  it('treats a parsed not_chemistry response as a sanitized parse failure', async () => {
    const resultPromise = runBenchmarkStages(input(providerFor([{ error: 'not_chemistry', message: 'secret details' }])))
    await expect(resultPromise).rejects.toThrow('Benchmark parse stage failed')
    await expect(resultPromise).rejects.not.toThrow('secret details')
  })

  it('skips assembly exactly when all principles return no recommendations', async () => {
    const calls: JsonCompletionRequest[] = []
    const result = await runBenchmarkStages(input(providerFor([parsed, ...Array.from({ length: 12 }, (_, i) => ({ principleNumber: i + 1, recommendations: [] }))], calls)))
    expect(calls.map(c => c.stage)).toEqual(['parse', ...Array.from({ length: 12 }, (_, i) => `principle-${i + 1}`)])
    expect(result.assembled).toEqual({
      revisedProtocol: 'Mix acetone.',
      overallAssessment: {
        greenPrinciplesViolated: [],
        mostImpactfulChange: 'No changes needed — this protocol already follows green chemistry principles.',
        experimentalValidationNeeded: false,
        disclaimer: 'This protocol was evaluated against all 12 Principles of Green Chemistry and no significant improvements were identified.',
      },
    })
  })

  it('normalizes omitted optional recommendation fields from PRINCIPLE_SCHEMA responses', async () => {
    const minimal = { stepNumber: 1, original: { chemical: 'Acetone', issue: 'volatile' }, alternative: { chemical: 'Water', rationale: 'safer' } }
    const responses = [parsed, ...Array.from({ length: 12 }, (_, i) => ({ principleNumber: i + 1, recommendations: i === 0 ? [minimal] : [] })), { action: 'confirm', revisedConfidence: 'medium', revisedRationale: 'supported', evidenceAssessment: { supportsOriginalIssue: true, supportsAlternative: true, contextMatch: 'strong', quantitativeData: false }, concerns: [] }, { revisedProtocol: 'unchanged', overallAssessment: { greenPrinciplesViolated: [], mostImpactfulChange: 'none', experimentalValidationNeeded: false, disclaimer: 'x' } }]
    const result = await runBenchmarkStages(input(providerFor(responses), { frozenLiteratureMatches: [] }))
    expect(result.recommendations[0]).toEqual(expect.objectContaining({ principleNumbers: [1], principleNames: ['Prevention'], severity: 'medium', confidenceLevel: 'medium' }))
  })

  it('rejects parse steps with malformed chemical name or role elements', async () => {
    const malformed = { ...parsed, steps: [{ ...parsed.steps[0], chemicals: [{ name: 42, role: 'solvent' }] }] }
    await expect(runBenchmarkStages(input(providerFor([malformed])))).rejects.toThrow('Benchmark parse stage failed')
  })

  it('assigns unique IDs when recommendations omit IDs', async () => {
    const first = recommendation(1)
    const second = { ...recommendation(2), original: { chemical: 'Ethanol', issue: 'flammable' } }
    const responses = [parsed, { principleNumber: 1, recommendations: [first] }, { principleNumber: 2, recommendations: [second] }, ...Array.from({ length: 10 }, (_, i) => ({ principleNumber: i + 3, recommendations: [] })), new Error('reevaluation unavailable'), new Error('reevaluation unavailable'), { revisedProtocol: 'r', overallAssessment: { greenPrinciplesViolated: [1], mostImpactfulChange: 'x', experimentalValidationNeeded: true, disclaimer: 'x' } }]
    const result = await runBenchmarkStages(input(providerFor(responses), { frozenLiteratureMatches: [] }))
    expect(result.recommendations.map(r => r.id)).toHaveLength(2)
    expect(new Set(result.recommendations.map(r => r.id)).size).toBe(2)
  })

  it('discards provider evidence and builds evidence only from frozen matches', async () => {
    const providerEvidence = { why_flagged: [{ source: 'provider', content: 'secret' }], why_replacement: [], citations: [{ source_id: 'provider', source_name: 'Provider', citation: 'fake' }] }
    const supplied = { ...recommendation(), evidence: providerEvidence }
    const responses = [parsed, ...Array.from({ length: 12 }, (_, i) => ({ principleNumber: i + 1, recommendations: i === 0 ? [supplied] : [] })), { action: 'confirm', revisedConfidence: 'medium', revisedRationale: 'supported', evidenceAssessment: { supportsOriginalIssue: true, supportsAlternative: true, contextMatch: 'strong', quantitativeData: false }, concerns: [] }, { revisedProtocol: 'r', overallAssessment: { greenPrinciplesViolated: [1], mostImpactfulChange: 'x', experimentalValidationNeeded: true, disclaimer: 'x' } }]
    const result = await runBenchmarkStages(input(providerFor(responses), { frozenLiteratureMatches: [evidence] }))
    expect(result.recommendations[0].evidence?.citations.map(c => c.source_id)).toEqual(['e1'])
    expect(JSON.stringify(result.recommendations[0].evidence)).not.toContain('provider')
  })

  it('stores validated reevaluation metadata and enforces candidate-only downgrade metadata', async () => {
    const reevaluation = { action: 'confirm', revisedConfidence: 'high', revisedRationale: 'supported', evidenceAssessment: { supportsOriginalIssue: true, supportsAlternative: true, contextMatch: 'strong', quantitativeData: true }, concerns: [] }
    const responses = [parsed, ...Array.from({ length: 12 }, (_, i) => ({ principleNumber: i + 1, recommendations: i === 0 ? [recommendation()] : [] })), reevaluation, { revisedProtocol: 'r', overallAssessment: { greenPrinciplesViolated: [1], mostImpactfulChange: 'x', experimentalValidationNeeded: true, disclaimer: 'x' } }]
    const result = await runBenchmarkStages(input(providerFor(responses), { frozenLiteratureMatches: [{ ...evidence, candidateStatus: 'candidate_pending_adjudication' }] }))
    expect(result.recommendations[0].confidenceLevel).toBe('low')
    expect((result.recommendations[0].evidence as unknown as { reevaluationMeta: unknown }).reevaluationMeta).toEqual(reevaluation.evidenceAssessment)
    expect(result.recommendations[0].alternative.caveats).toContain('Candidate-only evidence cannot independently confirm or suppress this intervention.')
  })

  it('uses privacy-safe reevaluation IDs and preserves equal-score inferred ranking ties', async () => {
    const first = { ...recommendation(), original: { chemical: 'SecretChemicalAlpha', issue: 'issue' } }
    const second = { ...recommendation(2), original: { chemical: 'SecretChemicalBeta', issue: 'issue' } }
    const responses = [parsed, { principleNumber: 1, recommendations: [first] }, { principleNumber: 2, recommendations: [second] }, ...Array.from({ length: 10 }, (_, i) => ({ principleNumber: i + 3, recommendations: [] })), new Error('reevaluation unavailable'), new Error('reevaluation unavailable'), { revisedProtocol: 'r', overallAssessment: { greenPrinciplesViolated: [1], mostImpactfulChange: 'x', experimentalValidationNeeded: true, disclaimer: 'x' } }]
    const calls: JsonCompletionRequest[] = []
    const result = await runBenchmarkStages(input(providerFor(responses, calls), { frozenLiteratureMatches: [] }))
    expect(calls.map(c => c.stage).filter(s => s.startsWith('reevaluate-'))).toEqual(['reevaluate-1-1', 'reevaluate-2-1'])
    expect(calls.map(c => c.stage).join('|')).not.toContain('SecretChemical')
    expect(result.recommendations.map(r => r.original.chemical)).toEqual(['SecretChemicalAlpha', 'SecretChemicalBeta'])
  })
})
