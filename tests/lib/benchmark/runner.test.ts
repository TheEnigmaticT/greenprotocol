import { describe, expect, it, vi } from 'vitest'
import { runFixtureBenchmark, sanitizeBenchmarkOutput, type FixtureBenchmarkConfig } from '@/lib/benchmark/runner'
import type { BenchmarkProvider } from '@/lib/benchmark/provider'

const parsed = { protocolTitle: 'Fixture', chemistrySubdomain: 'organic', steps: [{ stepNumber: 1, description: 'mix', chemicals: [{ name: 'water', role: 'solvent' }], conditions: {} }] }
const rec = { stepNumber: 1, original: { chemical: 'water', issue: 'waste' }, alternative: { chemical: 'ethanol', rationale: 'less waste' }, principleNumbers: [1], principleNames: ['Prevention'], severity: 'low', confidenceLevel: 'medium' }
function provider(): BenchmarkProvider {
  return { completeJson: vi.fn(async <T>(request: Parameters<BenchmarkProvider['completeJson']>[0]) => {
    const data = request.stage === 'parse' ? parsed : request.stage.startsWith('principle-') ? { principleNumber: Number(request.stage.split('-')[1]), recommendations: request.stage === 'principle-1' ? [rec] : [] } : request.stage.startsWith('reevaluate-') ? { action: 'confirm', revisedConfidence: 'medium', revisedRationale: 'supported', evidenceAssessment: { supportsOriginalIssue: true, supportsAlternative: true, contextMatch: 'strong', quantitativeData: false }, concerns: [] } : { revisedProtocol: 'changed', overallAssessment: { greenPrinciplesViolated: [1], mostImpactfulChange: 'x', experimentalValidationNeeded: true, disclaimer: 'fixture' } }
    return { data: data as T, provider: 'fake', model: request.model, stage: request.stage, usage: { totalTokens: 3 } }
  }) as BenchmarkProvider['completeJson'] }
}

const config = (): FixtureBenchmarkConfig => ({ cases: [{ caseId: 'case-a', protocolText: 'Mix water.', frozenLiteratureMatches: [], analysisMetadata: { generatedAt: '2026-01-01', gcaiVersion: 'test', methodologyVersion: 'test' } }], models: [{ model: 'model-a', provider: provider() }], repetitions: 1, warmup: false })

describe('fixture benchmark runner', () => {
  it('runs injected providers and excludes warmup from measured output', async () => {
    const output = await runFixtureBenchmark({ ...config(), repetitions: 1, warmup: true })
    expect(output.runs).toHaveLength(1)
    expect(output.runs[0]).toEqual(expect.objectContaining({ caseId: 'case-a', model: 'model-a', repetition: 1 }))
    expect(output.runs[0]).not.toHaveProperty('protocolText')
    expect(output.runs[0].quality.recommendationCount).toBe(1)
  })

  it('defaults to three measured repetitions and never serializes prompts or completions', () => {
    const sanitized = sanitizeBenchmarkOutput({ version: 1, repetitions: 1, runs: [{ caseId: 'fixture-1', model: 'model', repetition: 1, wallClockMs: 3, phaseLatencyMs: { parse: 2, evil: 'prompt-leak' }, quality: { schemaValid: true, stageCount: 1, failedStageCount: 0, principleCoverage: 1, recommendationCount: 2, flags: ['ok', 'raw-response'] }, completion: 'secret completion' }] } as never)
    expect(sanitized).not.toMatchObject({ protocolText: expect.anything(), completion: 'secret completion' })
    expect(sanitized).toEqual({ version: 1, repetitions: 1, runs: [{ caseId: 'fixture-1', model: 'model', repetition: 1, wallClockMs: 3, phaseLatencyMs: { parse: 2 }, quality: { schemaValid: true, stageCount: 1, failedStageCount: 0, principleCoverage: 1, recommendationCount: 2, flags: ['ok'] } }] })
  })

  it('rejects non-generated case discriminators instead of collapsing them', () => {
    expect(() => sanitizeBenchmarkOutput({ version: 1, repetitions: 1, runs: [{ caseId: 'secret-id', model: 'model', repetition: 1, wallClockMs: 1, phaseLatencyMs: {}, quality: {} }] })).toThrow(/case id/i)
  })

  it('drops malformed nested latency and quality values rather than passing arbitrary data through', () => {
    const sanitized = sanitizeBenchmarkOutput({ version: 'one', repetitions: -1, runs: [{ caseId: 'fixture-2', model: 42, repetition: '1', wallClockMs: Infinity, phaseLatencyMs: { parse: 4, nested: { leak: 'x' }, prompt: 8 }, quality: { schemaValid: 'yes', stageCount: 1, failedStageCount: 0, principleCoverage: 1, recommendationCount: 1, flags: ['safe', 9, 'prompt: secret'] } }] })
 expect(sanitized).toEqual({ version: 1, repetitions: 0, runs: [{ caseId: 'fixture-2', model: 'unknown', repetition: 0, wallClockMs: 0, phaseLatencyMs: { parse: 4 }, quality: { schemaValid: false, stageCount: 1, failedStageCount: 0, principleCoverage: 1, recommendationCount: 1, flags: ['safe'] } }] })
  })

  it('retains privacy-safe reevaluation stage latency metrics', () => {
    const sanitized = sanitizeBenchmarkOutput({
      version: 1, repetitions: 1,
      runs: [{ caseId: 'fixture-1', model: 'model', repetition: 1, wallClockMs: 3, phaseLatencyMs: { 'reevaluate-1-1': 7, assemble: 8, parse: 2 }, quality: {} }],
    })
    expect(sanitized).toEqual(expect.objectContaining({
      runs: [expect.objectContaining({ phaseLatencyMs: { 'reevaluate-1-1': 7, assemble: 8, parse: 2 } })],
    }))
  })

  it('allows repeated measurements for the same fixture and model', () => {
    const sanitized = sanitizeBenchmarkOutput({
      version: 1,
      repetitions: 3,
      runs: [1, 2, 3].map(repetition => ({ caseId: 'fixture-1', model: 'model', repetition, wallClockMs: 1, phaseLatencyMs: {}, quality: {} })),
    })
    expect(sanitized.runs).toHaveLength(3)
  })

  it('allows multiple models for the same fixture and repetition', () => {
    const sanitized = sanitizeBenchmarkOutput({
      version: 1,
      repetitions: 1,
      runs: ['model-a', 'model-b'].map(model => ({ caseId: 'fixture-1', model, repetition: 1, wallClockMs: 1, phaseLatencyMs: {}, quality: {} })),
    })
    expect(sanitized.runs).toHaveLength(2)
  })

  it('rejects duplicate fixture model repetition tuples', () => {
    expect(() => sanitizeBenchmarkOutput({
      version: 1,
      repetitions: 1,
      runs: [1, 1].map(repetition => ({ caseId: 'fixture-1', model: 'model', repetition, wallClockMs: 1, phaseLatencyMs: {}, quality: {} })),
    })).toThrow(/duplicate benchmark run/i)
  })
})
