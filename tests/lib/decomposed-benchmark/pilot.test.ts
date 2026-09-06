import { expect, it } from 'vitest'
import { runDecomposedPilot, type DecomposedPilotCase } from '@/lib/decomposed-benchmark/pilot'
import type { DecomposedBenchmarkProvider, JsonCompletion, JsonCompletionRequest } from '@/lib/decomposed-benchmark/provider'

const caseOne: DecomposedPilotCase = {
  caseId: 'alana-1',
  protocolText: '1. Add acetone (10 mL).',
  eligibility: [{ sourceQuote: '1. Add acetone (10 mL).', material: 'acetone', principleNumber: 5, reason: 'Targeted test candidate' }],
  evidenceByAlternative: {},
}

it('records a local-only per-stage telemetry record for each pilot case', async () => {
  const provider: DecomposedBenchmarkProvider = {
    async completeJson<T>(request: JsonCompletionRequest): Promise<JsonCompletion<T>> {
      const data = request.stage === 'extract-materials-span-1'
        ? { stepNumber: 1, materials: [{ mention: 'acetone', canonicalName: 'acetone', role: 'solvent', quantity: '10 mL', conditions: [] }], mixtures: [] }
        : request.stage === 'extract-operations-span-1'
          ? { stepNumber: 1, operations: [{ kind: 'add', sourceText: '1. Add acetone (10 mL).', repetitions: null, temperature: null, duration: null, atmosphere: null }] }
          : request.stage.startsWith('assess-issue-')
            ? { applicable: false, issue: '', severity: 'low' }
            : { omissions: [], unsupportedInferences: [] }
      return { data: data as T, provider: 'test', model: request.model, stage: request.stage, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, costUsd: 0.004, generationId: 'generation-1' }
    },
  }
  const result = await runDecomposedPilot({ cases: [caseOne], model: 'google/gemma-4-31b-it', provider, now: () => 100 })

  expect(result.model).toBe('google/gemma-4-31b-it')
  expect(result.cases).toHaveLength(1)
  expect(result.cases[0]).toMatchObject({ caseId: 'alana-1', status: 'completed' })
  expect(result.cases[0]?.stages).toEqual(expect.arrayContaining([expect.objectContaining({ stage: 'extract-materials-span-1', provider: 'test', totalTokens: 5, costUsd: 0.004 })]))
})

it('uses the configured independent audit model only for fact audits', async () => {
  const models: Array<{ stage: string; model: string }> = []
  const provider: DecomposedBenchmarkProvider = {
    async completeJson<T>(request: JsonCompletionRequest): Promise<JsonCompletion<T>> {
      models.push({ stage: request.stage, model: request.model })
      const data = request.stage === 'extract-materials-span-1'
        ? { stepNumber: 1, materials: [{ mention: 'acetone', canonicalName: 'acetone', role: 'solvent', quantity: '10 mL', conditions: [] }], mixtures: [] }
        : request.stage === 'extract-operations-span-1'
          ? { stepNumber: 1, operations: [{ kind: 'add', sourceText: '1. Add acetone (10 mL).', repetitions: null, temperature: null, duration: null, atmosphere: null }] }
          : request.stage.startsWith('assess-issue-')
            ? { applicable: false, issue: '', severity: 'low' }
            : { omissions: [], unsupportedInferences: [] }
      return { data: data as T, provider: 'test', model: request.model, stage: request.stage, usage: {} }
    },
  }

  await runDecomposedPilot({ cases: [caseOne], model: 'candidate-model', auditModel: 'audit-model', provider })

  expect(models.filter(item => item.stage.startsWith('audit-')).map(item => item.model)).toEqual(['audit-model'])
  expect(models.filter(item => !item.stage.startsWith('audit-')).map(item => item.model)).toEqual(['candidate-model', 'candidate-model', 'candidate-model'])
})
