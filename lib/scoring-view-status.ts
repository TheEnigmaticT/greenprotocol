/** Compare an editable view with the preserved original; not a signature or digest verifier. */
export interface ScoringViewStatus {
  kind: 'no-original-record' | 'matches-original' | 'differs-from-original' | 'comparison-unavailable'
  scoresMatchOriginal: boolean | null
  inputsMatchOriginal: boolean | null
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function jsonValue(value: unknown, depth = 0): string {
  if (depth > 100) throw new Error('Comparison depth exceeded')
  if (value === undefined || value === null) return 'null'
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite value')
  if (Array.isArray(value)) return '[' + Array.from(value, item => jsonValue(item, depth + 1)).join(',') + ']'
  if (record(value)) return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort()
    .map(key => JSON.stringify(key) + ':' + jsonValue(value[key], depth + 1)).join(',') + '}'
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Non-JSON value')
  return serialized
}

export function getScoringViewStatus(analysis: unknown): ScoringViewStatus {
  const unknown = { scoresMatchOriginal: null, inputsMatchOriginal: null }
  if (!record(analysis) || analysis.scoringInputManifest === undefined) return { kind: 'no-original-record', ...unknown }
  const original = analysis.scoringInputManifest
  if (!record(original) || !record(original.request) || !record(original.scores)) return { kind: 'comparison-unavailable', ...unknown }
  try {
    const scoresMatchOriginal = jsonValue(analysis.deterministicScores) === jsonValue(original.scores)
      && jsonValue(analysis.wasteAnalysis) === jsonValue(original.scores.waste_analysis)
    if (!Array.isArray(analysis.steps) || !Array.isArray(original.request.steps)) throw new Error('Missing steps')
    const steps = analysis.steps.map(step => {
      if (!record(step) || !Array.isArray(step.chemicals)) throw new Error('Invalid step')
      return {
        stepNumber: step.stepNumber, description: step.description, conditions: step.conditions,
        chemicals: step.chemicals.map(chemical => {
          if (!record(chemical)) throw new Error('Invalid chemical')
          return { name: chemical.name, role: chemical.role, ...(chemical.processUse ? { processUse: chemical.processUse } : {}) }
        }),
      }
    })
    const currentAmounts = analysis.steps.flatMap(step => step.chemicals.map((chemical: Record<string, unknown>) => ({
      name: chemical.name, role: chemical.role, quantity: chemical.quantity || '', quantity_kg: chemical.quantityKg ?? null,
      step_number: step.stepNumber, ...(chemical.processUse ? { process_use: chemical.processUse } : {}),
    })))
    const recordedAmounts = Array.isArray(original.request.chemicals) ? original.request.chemicals.map(chemical => {
      if (!record(chemical)) throw new Error('Invalid recorded chemical')
      return { name: chemical.name, role: chemical.role, quantity: chemical.raw_quantity ?? chemical.quantity ?? '', quantity_kg: chemical.quantity_kg ?? null,
        step_number: chemical.step_number, ...(chemical.process_use ? { process_use: chemical.process_use } : {}) }
    }) : null
    const inputsMatchOriginal = jsonValue(steps) === jsonValue(original.request.steps)
      && jsonValue(currentAmounts) === jsonValue(recordedAmounts)
    return { kind: scoresMatchOriginal && inputsMatchOriginal ? 'matches-original' : 'differs-from-original', scoresMatchOriginal, inputsMatchOriginal }
  } catch {
    return { kind: 'comparison-unavailable', ...unknown }
  }
}
