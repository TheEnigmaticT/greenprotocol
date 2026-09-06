import { describe, expect, it } from 'vitest'
import { runLocalP5Session } from '@/lib/decomposed-benchmark/local-session'
import type { DecomposedBenchmarkProvider, JsonCompletionRequest } from '@/lib/decomposed-benchmark/provider'

const fixture = { caseId: 'test', protocolText: '1. Add acetone (10 mL).', eligibility: [{ sourceQuote: '1. Add acetone (10 mL).', material: 'acetone', principleNumber: 5, reason: 'Review' }], evidenceByAlternative: {} }

describe('local P5 session', () => {
  it('serializes worker/auditor calls and persists both roles before returning a proposal', async () => {
    let active = 0
    let maximum = 0
    const events: Record<string, unknown>[] = []
    const provider: DecomposedBenchmarkProvider = { async completeJson<T>(r: JsonCompletionRequest) {
      maximum = Math.max(maximum, ++active)
      await new Promise(resolve => setTimeout(resolve, 1))
      const data = r.stage.startsWith('extract-materials') ? { stepNumber: 1, materials: [], mixtures: [] }
        : r.stage.startsWith('extract-operations') ? { stepNumber: 1, operations: [] }
          : r.stage === 'audit-materials' ? { omissions: [], unsupportedInferences: [] }
            : { applicable: false, issue: 'No supplied issue', severity: 'low' }
      active--
      return { data: data as T, provider: 'ollama', model: r.model, stage: r.stage, costUsd: 0 }
    } }
    const result = await runLocalP5Session({ fixture, workerModel: 'worker', auditorModel: 'auditor', provider, persist: async e => { events.push(e) } })
    expect(maximum).toBe(1)
    expect(events.filter(e => e.kind === 'response').map(e => e.role)).toContain('auditor')
    expect(result.status).toBe('completed')
    expect(result.applied).toBe(false)
    expect(result.scientificAcceptance).toBe('unverified')
    expect(result.result?.finalProtocol).toBe(fixture.protocolText)
  })

  it('archives a failed attempt and prevents queued sibling requests after failure', async () => {
    let calls = 0
    const events: Record<string, unknown>[] = []
    const provider: DecomposedBenchmarkProvider = { async completeJson() { calls++; const error = new Error('synthetic failure'); Object.defineProperty(error, 'rawResponse', { value: 'raw failed response' }); throw error } }
    const result = await runLocalP5Session({ fixture, workerModel: 'worker', auditorModel: 'auditor', provider, persist: async e => { events.push(e) } })
    expect(result.status).toBe('failed')
    expect(calls).toBe(1)
    expect(events.some(e => e.kind === 'failure')).toBe(true)
    expect(events.find(e => e.kind === 'failure')?.rawResponse).toBe('raw failed response')
    expect(result.result).toBeNull()
  })

  it('never starts inference when request persistence fails', async () => {
    let calls = 0
    const provider: DecomposedBenchmarkProvider = { async completeJson() { calls++; throw new Error('must not run') } }
    await expect(runLocalP5Session({ fixture, workerModel: 'worker', auditorModel: 'auditor', provider, persist: async () => { throw new Error('disk failure') } })).rejects.toThrow('disk failure')
    expect(calls).toBe(0)
  })
})
