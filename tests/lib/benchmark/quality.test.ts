import { describe, expect, it } from 'vitest'
import { assessStructuralQuality } from '@/lib/benchmark/quality'
import type { BenchmarkRunResult } from '@/lib/benchmark/stage-runner'

const result = (overrides: Partial<BenchmarkRunResult> = {}): BenchmarkRunResult => ({
  parsed: { protocolTitle: 'Fixture', chemistrySubdomain: 'organic', steps: [] },
  principleResults: [{ principleNumber: 1, recommendations: [] }],
  recommendations: [],
  reevaluations: [],
  telemetry: [
    { stage: 'parse', model: 'm', latencyMs: 10, shapeMetadata: { schemaValid: true, topLevelKeys: [], outputHash: 'h' } },
    { stage: 'principle-1', model: 'm', latencyMs: 20, error: { message: 'Benchmark provider request failed' } },
  ],
  ...overrides,
})

describe('structural benchmark quality', () => {
  it('reports schema, coverage, failures, and recommendation counts without model advice', () => {
    const quality = assessStructuralQuality(result())
    expect(quality).toEqual(expect.objectContaining({ schemaValid: false, stageCount: 2, failedStageCount: 1, principleCoverage: 0, recommendationCount: 0 }))
    expect(quality).not.toHaveProperty('recommendedModel')
  })

  it('flags unsafe or unsupported recommendation shapes using conservative heuristics', () => {
    const quality = assessStructuralQuality(result({ recommendations: [{ stepNumber: 1, original: { chemical: 'x', issue: 'x' }, alternative: { chemical: '', rationale: '' }, severity: 'high', confidenceLevel: 'high', principleNumbers: [], principleNames: [] }] as never }))
    expect(quality.flags).toEqual(expect.arrayContaining(['empty-alternative', 'unsupported-confidence']))
  })

  it('does not treat a provider failure as a safety finding', () => {
    const quality = assessStructuralQuality(result({ telemetry: [{ stage: 'parse', model: 'm', latencyMs: 1, error: { message: 'Benchmark provider request failed' } }] }))
    expect(quality.flags).not.toContain('unsafe-recommendation')
    expect(quality.schemaValid).toBe(false)
  })
})
