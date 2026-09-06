import { describe, expect, it } from 'vitest'
import { createSource } from '../../../lib/local-qualification/source'
import { createGraph } from '../../../lib/local-qualification/graph'
import { PRINCIPLE_IDS } from '../../../lib/local-qualification/principles'
import { OLLAMA_PILOT_MODELS } from '../../../lib/decomposed-benchmark/ollama-provider'
import { prepareLocalAnalysis } from '../../../lib/local-qualification/local-analysis-options'
import { prepareExtractionRequests } from '../../../lib/local-qualification/extraction-jobs'

describe('explicit local full-source analysis preparation, not science approval', () => {
  it('pins actual request contracts without inference or invented graph/evidence', () => {
    const source = createSource('Stir the mixture.')
    const { options, authorization } = prepareLocalAnalysis(source, 'local-test-v1')
    expect(options.timeoutMs).toBe(240_000)
    expect(options.localTransportTimeoutMs).toBe(180_000)
    expect(options.extraction.id).toBe('local-full-source-v2-transport180s-stage240s-extraction')
    expect(options.extraction.model).toBe(OLLAMA_PILOT_MODELS[0])
    expect(options.inventory.model).toBe(OLLAMA_PILOT_MODELS[1])
    expect(authorization.sourceHashes).toEqual([source.id.slice(7)])
    expect(Object.keys(authorization.roleContracts).sort()).toEqual(['extraction', 'inventory', ...PRINCIPLE_IDS].sort())
    for (const manifest of [options.extraction, options.inventory]) {
      const requests = prepareExtractionRequests(source, manifest)
      expect(requests).toHaveLength(1)
      expect(authorization.roleContracts[manifest.role]).toBe(requests[0].evidence!.contractHash)
    }
    const graph = createGraph(source, [])
    for (const principle of PRINCIPLE_IDS) {
      const input = options.principlePolicy(principle, source, graph)!
      expect(input.graph).toEqual(graph)
      expect(input.dependencyFacts).toEqual({})
      expect(input.evidence.records).toEqual([])
      expect(input.evidence.snapshots).toEqual([])
    }
    expect(options.applicabilityPolicy).toBeUndefined()
    expect(Object.isFrozen(authorization.roleContracts)).toBe(true)
  })
  it('reconstructs the exact legacy contract only for receipt recovery', () => {
    const { options } = prepareLocalAnalysis(createSource('Synthetic.'), 'old-review', 'legacy-55s-60s')
    expect(options.extraction.id).toBe('local-full-source-v1-extraction')
    expect(options.timeoutMs).toBe(60_000)
    expect(options.localTransportTimeoutMs).toBeUndefined()
  })
  it('rejects empty input before storage or inference', () => {
    expect(() => prepareLocalAnalysis(createSource(''), 'local-test-v1')).toThrow()
  })
})
