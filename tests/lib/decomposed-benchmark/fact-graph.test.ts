import { expect, it } from 'vitest'
import { runDecomposedBenchmark, type DecomposedBenchmarkInput } from '@/lib/decomposed-benchmark/runner'
import type { DecomposedBenchmarkProvider, JsonCompletion, JsonCompletionRequest } from '@/lib/decomposed-benchmark/provider'

it('separates material facts from operational facts and audits each scope', async () => {
  const calls: string[] = []
  let operationalAuditSystem = ''
  const responses: unknown[] = [
    { stepNumber: 1, materials: [{ mention: 'water', canonicalName: 'water', role: 'wash', quantity: null, conditions: [] }], mixtures: [] },
    { stepNumber: 1, operations: [{ kind: 'wash', sourceText: 'Wash with water 2 x 10 mL', repetitions: '2', temperature: null, duration: null, atmosphere: null }, { kind: 'filter', sourceText: 'filter', repetitions: null, temperature: null, duration: null, atmosphere: null }, { kind: 'concentrate', sourceText: 'concentrate at 40 °C', repetitions: null, temperature: '40 °C', duration: null, atmosphere: null }] },
    { omissions: [], unsupportedInferences: [] },
    { applicable: false, issue: '', severity: 'low' },
  ]
  const provider: DecomposedBenchmarkProvider = {
    async completeJson<T>(request: JsonCompletionRequest): Promise<JsonCompletion<T>> {
      calls.push(request.stage)
      if (request.stage === 'audit-operations') operationalAuditSystem = request.system
      return { data: responses.shift() as T, provider: 'test', model: request.model, stage: request.stage, usage: {} }
    },
  }
  const input: DecomposedBenchmarkInput = {
    protocolText: 'Wash with water 2 x 10 mL, filter, and concentrate at 40 °C.',
    model: 'candidate-model',
    provider,
    eligibility: [{ sourceQuote: 'Wash with water 2 x 10 mL, filter, and concentrate at 40 °C.', material: 'water', principleNumber: 1, reason: 'Fact graph scope test' }],
    evidenceByAlternative: {},
  }

  const result = await runDecomposedBenchmark(input)

  expect(calls).toEqual(['extract-materials-span-1', 'extract-operations-span-1', 'audit-materials', 'assess-issue-span-1-water-p1'])
  expect(operationalAuditSystem).toBe('')
  expect(result.extractedSteps[0]?.operations).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'wash', repetitions: '2' }),
    expect.objectContaining({ kind: 'concentrate', temperature: '40 °C' }),
  ]))
})
