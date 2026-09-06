import { runDecomposedBenchmark, type EligibilityCandidate, type EvidenceExcerpt } from './runner'
import type { DecomposedBenchmarkProvider, JsonCompletionRequest } from './provider'

export interface DecomposedPilotCase {
  caseId: string
  protocolText: string
  eligibility: EligibilityCandidate[]
  evidenceByAlternative: Record<string, EvidenceExcerpt[]>
}

export interface PilotStageTelemetry {
  stage: string
  provider: string
  model: string
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number
  generationId?: string
  output?: unknown
}

export interface DecomposedPilotResult {
  model: string
  cases: Array<{
    caseId: string
    status: 'completed' | 'failed'
    stages: PilotStageTelemetry[]
    review?: {
      sourceFormat: 'line-oriented' | 'prose'
      finalProtocol: string
      extractedSteps: unknown[]
      changeCards: unknown[]
    }
    error?: string
  }>
}

export async function runDecomposedPilot(input: {
  cases: DecomposedPilotCase[]
  model: string
  provider: DecomposedBenchmarkProvider
  auditModel?: string
  auditProvider?: DecomposedBenchmarkProvider
  now?: () => number
}): Promise<DecomposedPilotResult> {
  const cases: DecomposedPilotResult['cases'] = []
  const now = input.now ?? Date.now
  for (const fixture of input.cases) {
    const stages: PilotStageTelemetry[] = []
    const recordingProvider: DecomposedBenchmarkProvider = {
      async completeJson<T>(request: JsonCompletionRequest) {
        const start = now()
        const response = await input.provider.completeJson<T>(request)
        stages.push({
          stage: request.stage,
          provider: response.provider,
          model: response.model,
          latencyMs: response.latencyMs ?? now() - start,
          inputTokens: response.usage?.inputTokens,
          outputTokens: response.usage?.outputTokens,
          totalTokens: response.usage?.totalTokens,
          costUsd: response.costUsd,
          generationId: response.generationId,
          output: response.data,
        })
        return response
      },
    }
    try {
      const benchmark = await runDecomposedBenchmark({
        ...fixture,
        model: input.model,
        provider: recordingProvider,
        auditModel: input.auditModel,
        auditProvider: input.auditProvider,
      })
      cases.push({
        caseId: fixture.caseId,
        status: 'completed',
        stages,
        review: { sourceFormat: benchmark.sourceFormat, finalProtocol: benchmark.finalProtocol, extractedSteps: benchmark.extractedSteps, changeCards: benchmark.changeCards },
      })
    } catch (error) {
      cases.push({ caseId: fixture.caseId, status: 'failed', stages, error: error instanceof Error ? error.message : 'Decomposed benchmark case failed' })
    }
  }
  return { model: input.model, cases }
}
