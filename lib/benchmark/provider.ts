export type JsonSchema = Record<string, unknown>

export interface JsonCompletionRequest {
  model: string
  stage: string
  system: string
  user: string
  schema: JsonSchema
}

export interface CompletionUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface JsonCompletion<T = unknown> {
  data: T
  usage: CompletionUsage
  provider: string
  model: string
  stage: string
  costUsd?: number
  generationId?: string
}

export interface BenchmarkProvider {
  completeJson<T = unknown>(request: JsonCompletionRequest): Promise<JsonCompletion<T>>
}

export class BenchmarkProviderError extends Error {
  readonly provider: string
  readonly model: string
  readonly stage: string
  readonly category: string
  readonly status?: number

  constructor(message: string, metadata: Pick<JsonCompletionRequest, 'model' | 'stage'> & {
    provider: string
    category?: string
    status?: number
  }, _options?: ErrorOptions) {
    void _options
    super(message)
    this.name = 'BenchmarkProviderError'
    this.provider = metadata.provider
    this.model = metadata.model
    this.stage = metadata.stage
    this.category = metadata.category ?? 'unknown'
    this.status = metadata.status
  }
}
