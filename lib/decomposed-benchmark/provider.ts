export interface JsonCompletionRequest {
  model: string
  stage: string
  system: string
  user: string
  schema: Record<string, unknown>
}

export interface JsonCompletion<T = unknown> {
  data: T
  provider: string
  model: string
  stage: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  latencyMs?: number
  costUsd?: number
  generationId?: string
}

/** A narrow, benchmark-only dependency. It cannot call application routes. */
export interface DecomposedBenchmarkProvider {
  completeJson<T = unknown>(request: JsonCompletionRequest): Promise<JsonCompletion<T>>
}
