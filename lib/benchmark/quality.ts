import type { Recommendation } from '@/lib/types'
import type { BenchmarkRunResult } from './stage-runner'
import type { StructuralQuality } from './types'

const unsafeWords = /carcinogen|explosive|acute toxic|highly toxic/i

export function assessStructuralQuality(result: BenchmarkRunResult): StructuralQuality {
  const telemetry = result.telemetry
  const failedStageCount = telemetry.filter(stage => !!stage.error).length
  const schemaValid = telemetry.length > 0 && failedStageCount === 0 && telemetry.every(stage => stage.shapeMetadata?.schemaValid === true)
  const principleStages = telemetry.filter(stage => /^principle-\d+$/.test(stage.stage))
  const principleCoverage = principleStages.filter(stage => !stage.error).length
  const flags = new Set<string>()
  for (const recommendation of result.recommendations as Recommendation[]) {
    if (!recommendation.alternative?.chemical?.trim() || !recommendation.alternative?.rationale?.trim()) flags.add('empty-alternative')
    if (!recommendation.principleNumbers?.length || recommendation.principleNumbers.some(n => n < 1 || n > 12)) flags.add('unsupported-confidence')
    if (unsafeWords.test(`${recommendation.alternative?.chemical ?? ''} ${recommendation.alternative?.rationale ?? ''}`)) flags.add('unsafe-recommendation')
  }
  return { schemaValid, stageCount: telemetry.length, failedStageCount, principleCoverage, recommendationCount: result.recommendations.length, flags: [...flags].sort() }
}
