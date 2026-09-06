import { OLLAMA_PILOT_MODELS } from '../decomposed-benchmark/ollama-provider'
import { principleRequestContractHash, type IsolatedAnalysisOptions } from './analysis'
import { prepareExtractionRequests, type ExtractionJobManifest } from './extraction-jobs'
import { createGraph } from './graph'
import type { LocalAuthorization } from './local-transport'
import { digest } from './manifests'
import { PRINCIPLE_IDS, PRINCIPLES } from './principles'
import { buildPrincipleJob } from './principle-jobs'
import { assertSource, type Source } from './source'

type NativeOptions = Omit<IsolatedAnalysisOptions, 'transport' | 'stageStore' | 'artifactStore'>
/** Full-source engineering execution with explicit absent evidence/dependency policy.
 * This is NOT a scientific qualification or a substitute for retrieval integration.
 */
export function prepareLocalAnalysis(source: Source, reviewId: string, executionContract: 'transport180s-stage240s' | 'legacy-55s-60s' = 'transport180s-stage240s'): { options: NativeOptions; authorization: LocalAuthorization } {
  assertSource(source)
  if (!source.bytes.length || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(reviewId)) throw new Error('LOCAL_ANALYSIS_INPUT_INVALID')
  if (!['transport180s-stage240s', 'legacy-55s-60s'].includes(executionContract)) throw new Error('LOCAL_ANALYSIS_INPUT_INVALID')
  const legacy = executionContract === 'legacy-55s-60s'
  const manifest = (role: 'extraction' | 'inventory'): ExtractionJobManifest => ({
    id: (legacy ? 'local-full-source-v1-' : 'local-full-source-v2-transport180s-stage240s-') + role, role, family: role === 'extraction' ? 'gemma' : 'qwen',
    model: OLLAMA_PILOT_MODELS[role === 'extraction' ? 0 : 1], providerSlug: 'ollama', outputKind: 'json_schema',
    maxSourceBytes: 4096, maxPromptTokens: 14336, maxCompletionTokens: 2048,
    prices: { prompt: 0, completion: 0, request: 0 }, attempt: 1,
  })
  const options: NativeOptions = {
    source, extraction: manifest('extraction'), inventory: manifest('inventory'), reviewId,
    policyVersion: 'local-no-supplied-evidence-v1', evidenceHash: digest('no-supplied-evidence-v1'), timeoutMs: legacy ? 60_000 : 240_000, ...(legacy ? {} : { localTransportTimeoutMs: 180_000 }),
    principlePolicy: (principle, original, graph) => ({
      principle, source: original, graph, category: PRINCIPLES[principle].eligibleCategories[0],
      workerID: 'local-gemma-worker', factIDs: graph.facts.map(f => f.id), dependencyFacts: {},
      evidence: { approvalID: 'no-supplied-evidence-v1', snapshots: [], records: [] },
    }),
  }
  const roleContracts: Record<string, string> = {}
  for (const m of [options.extraction, options.inventory]) for (const request of prepareExtractionRequests(source, m)) {
    roleContracts[m.role] = request.evidence!.contractHash
  }
  // An empty authentic graph is used ONLY to construct source-independent schemas.
  // It is never submitted as extracted output or counted as model/scientific evidence.
  const emptyGraph = createGraph(source, [])
  for (const principle of PRINCIPLE_IDS) {
    const bounded = buildPrincipleJob(options.principlePolicy(principle, source, emptyGraph)!)
    roleContracts[principle] = principleRequestContractHash(options.policyVersion, options.evidenceHash, principle, bounded)
  }
  return { options, authorization: Object.freeze({ mode: 'LOCAL', authorized: true, reviewId,
    sourceHashes: Object.freeze([source.id.slice(7)]), roleContracts: Object.freeze(roleContracts) }) }
}
