import { performance } from 'node:perf_hooks'
import { assessStructuralQuality } from './quality'
import { runBenchmarkStages } from './stage-runner'
import type { BenchmarkOutput, BenchmarkFixtureCase, BenchmarkModel, BenchmarkRunRecord, StructuralQuality } from './types'

export interface FixtureBenchmarkConfig {
  cases: BenchmarkFixtureCase[]
  models: BenchmarkModel[]
  repetitions?: number
  warmup?: boolean
  now?: () => number
}

export async function runFixtureBenchmark(config: FixtureBenchmarkConfig): Promise<BenchmarkOutput> {
  const repetitions = config.repetitions ?? 3
  if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error('repetitions must be a positive integer')
  const now = config.now ?? (() => performance.now())
  const runs: BenchmarkRunRecord[] = []
  for (const fixture of config.cases) {
    for (const model of config.models) {
      if (config.warmup !== false) await runBenchmarkStages({ ...fixture, model: model.model, provider: model.provider })
      for (let repetition = 1; repetition <= repetitions; repetition++) {
        const started = now()
        const result = await runBenchmarkStages({ ...fixture, model: model.model, provider: model.provider, now })
        const wallClockMs = Math.max(0, now() - started)
        const phaseLatencyMs: Record<string, number> = {}
        let costUsd = 0
        let hasCost = false
        for (const telemetry of result.telemetry) {
          phaseLatencyMs[telemetry.stage] = telemetry.latencyMs
          if (typeof telemetry.costUsd === 'number') { costUsd += telemetry.costUsd; hasCost = true }
        }
        runs.push({ caseId: fixture.caseId, model: model.model, repetition, wallClockMs, phaseLatencyMs, ...(hasCost ? { costUsd } : {}), quality: assessStructuralQuality(result) })
      }
    }
  }
  return { version: 1, repetitions, runs }
}

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const safeModel = (value: unknown): string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : 'unknown'
const safeFlag = (value: unknown): value is string => typeof value === 'string' && /^(?!prompt$|response$|completion$|trace$|raw-response$)[a-z0-9-]{1,64}$/i.test(value)
const safeStage = (value: unknown): value is string => typeof value === 'string' && /^(?:parse|principle-\d+|reevaluate-\d+-\d+|assemble|final-review)$/.test(value)
const safeCaseId = (value: unknown): value is string => typeof value === 'string' && /^fixture-[1-9][0-9]*$/.test(value)

function sanitizeQuality(value: unknown): StructuralQuality {
  const quality = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    schemaValid: quality.schemaValid === true,
    stageCount: finiteNumber(quality.stageCount) && quality.stageCount >= 0 ? quality.stageCount : 0,
    failedStageCount: finiteNumber(quality.failedStageCount) && quality.failedStageCount >= 0 ? quality.failedStageCount : 0,
    principleCoverage: finiteNumber(quality.principleCoverage) && quality.principleCoverage >= 0 ? quality.principleCoverage : 0,
    recommendationCount: finiteNumber(quality.recommendationCount) && quality.recommendationCount >= 0 ? quality.recommendationCount : 0,
    flags: Array.isArray(quality.flags) ? quality.flags.filter(safeFlag) : [],
  }
}

function sanitizeRun(value: unknown): BenchmarkRunRecord {
  const run = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  if (!safeCaseId(run.caseId)) throw new Error('Benchmark run has an invalid case ID')
  const phaseLatencyMs: Record<string, number> = {}
  if (run.phaseLatencyMs && typeof run.phaseLatencyMs === 'object' && !Array.isArray(run.phaseLatencyMs)) {
    for (const [stage, latency] of Object.entries(run.phaseLatencyMs)) if (safeStage(stage) && finiteNumber(latency) && latency >= 0) phaseLatencyMs[stage] = latency
  }
  return {
    caseId: run.caseId,
    model: safeModel(run.model),
    repetition: finiteNumber(run.repetition) && run.repetition >= 0 ? run.repetition : 0,
    wallClockMs: finiteNumber(run.wallClockMs) && run.wallClockMs >= 0 ? run.wallClockMs : 0,
    phaseLatencyMs,
    ...(finiteNumber(run.costUsd) && run.costUsd >= 0 ? { costUsd: run.costUsd } : {}),
    quality: sanitizeQuality(run.quality),
  }
}

/** Serialize only the documented benchmark result schema; raw model output is never retained. */
export function sanitizeBenchmarkOutput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const seen = new Set<string>()
  const runs = Array.isArray(input.runs) ? input.runs.map(value => {
    const run = sanitizeRun(value)
    const key = `${run.caseId}\u0000${run.model}\u0000${run.repetition}`
    if (seen.has(key)) throw new Error('Duplicate benchmark run tuple')
    seen.add(key)
    return run
  }) : []
  return {
    version: input.version === 1 ? 1 : 1,
    repetitions: finiteNumber(input.repetitions) && input.repetitions >= 0 ? input.repetitions : 0,
    runs,
  }
}
