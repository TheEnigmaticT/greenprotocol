import type { DecomposedBenchmarkProvider, JsonCompletion, JsonCompletionRequest } from './provider'

/** Exact installed inventory supplied for this standalone pilot; no aliases/cloud fallback. */
export const OLLAMA_PILOT_MODELS = Object.freeze([
  'hf.co/bartowski/google_gemma-4-31B-it-GGUF:Q5_K_M',
  'hf.co/unsloth/Qwen3.8-27B-GGUF:Q4_K_M',
] as const)

export interface OllamaJsonCompletion<T = unknown> extends JsonCompletion<T> {
  /** Non-enumerable private evidence: caller must explicitly persist to private storage. */
  readonly rawResponse: string
}

export class OllamaProviderError extends Error {
  declare readonly rawResponse: string
  declare readonly privateCause: unknown
  constructor(readonly code: string, rawResponse = '', cause?: unknown) {
    super(`Ollama ${code}`)
    this.name = 'OllamaProviderError'
    Object.defineProperties(this, {
      rawResponse: { value: rawResponse, enumerable: false },
      privateCause: { value: cause, enumerable: false },
    })
  }
}

interface Options {
  /** Injection for offline tests. Production default is native fetch; no endpoint option. */
  fetch?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
}

/**
 * New transport only: runner retains all scientific validation/approval authority.
 * API verified against https://docs.ollama.com/api/chat and
 * https://docs.ollama.com/capabilities/structured-outputs .
 * Serial calls; any sent-call failure halts this instance (no retries). Timeout abort
 * is not proof the local server stopped inference: reconcile before creating another instance.
 * Raw response/cause never appear in error messages or default JSON serialization.
 */
export class OllamaDecomposedProvider implements DecomposedBenchmarkProvider {
  private readonly fetcher: typeof fetch
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number
  private queue: Promise<unknown> = Promise.resolve()
  private halted = false

  constructor(options: Options = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 180_000
    this.maxResponseBytes = options.maxResponseBytes ?? 2_097_152
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 600_000 ||
        !Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes <= 0 || this.maxResponseBytes > 8_388_608) {
      throw new OllamaProviderError('INVALID_LIMIT')
    }
  }

  completeJson<T = unknown>(request: JsonCompletionRequest): Promise<OllamaJsonCompletion<T>> {
    // Snapshot synchronously: queued caller mutations cannot change transport authority.
    if (!(OLLAMA_PILOT_MODELS as readonly string[]).includes(request.model)) {
      return Promise.reject(new OllamaProviderError('MODEL_NOT_ALLOWED'))
    }
    const snapshot = structuredClone(request)
    const pending = this.queue.then(() => this.send<T>(snapshot))
    this.queue = pending.catch(() => undefined)
    return pending
  }

  private async send<T>(request: JsonCompletionRequest): Promise<OllamaJsonCompletion<T>> {
    if (this.halted) throw new OllamaProviderError('HALTED')
    const started = performance.now()
    const controller = new AbortController()
    const chunks: Uint8Array[] = []
    let bytes = 0
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const raw = () => Buffer.concat(chunks).toString('utf8')
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.halted = true
        reject(new OllamaProviderError('TIMEOUT', raw()))
        controller.abort()
        void reader?.cancel().catch(() => undefined)
      }, this.timeoutMs)
    })
    const transport = async (): Promise<OllamaJsonCompletion<T>> => {
      const response = await this.fetcher('http://localhost:11434/api/chat', {
        method: 'POST', redirect: 'error', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({
          model: request.model,
          messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
          format: request.schema, stream: false, think: false,
          options: { temperature: 0, num_predict: 2048, num_ctx: 16384 },
        }),
      })
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => undefined)
        throw new OllamaProviderError('TIMEOUT', raw())
      }
      if (!response.body) throw new OllamaProviderError('INVALID_ENVELOPE')
      reader = response.body.getReader()
      while (true) {
        const chunk = await reader.read()
        if (controller.signal.aborted) throw new OllamaProviderError('TIMEOUT', raw())
        if (chunk.done) break
        const remaining = this.maxResponseBytes - bytes
        chunks.push(chunk.value.slice(0, remaining))
        bytes += Math.min(chunk.value.byteLength, remaining)
        if (chunk.value.byteLength > remaining) throw new OllamaProviderError('RESPONSE_TOO_LARGE', raw())
      }
      const rawResponse = raw()
      if (!response.ok) throw new OllamaProviderError('HTTP_ERROR', rawResponse)
      let value
      try { value = JSON.parse(rawResponse) } catch { throw new OllamaProviderError('INVALID_ENVELOPE', rawResponse) }
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.error) throw new OllamaProviderError('INVALID_ENVELOPE', rawResponse)
      if (value.model !== request.model) throw new OllamaProviderError('MODEL_MISMATCH', rawResponse)
      if (value.done !== true || value.done_reason !== 'stop') throw new OllamaProviderError('INCOMPLETE_RESPONSE', rawResponse)
      if (value.message?.role !== 'assistant' || typeof value.message?.content !== 'string' || value.message.tool_calls?.length) throw new OllamaProviderError('INVALID_ENVELOPE', rawResponse)
      const inputTokens = value.prompt_eval_count
      const outputTokens = value.eval_count
      if (![inputTokens, outputTokens, inputTokens + outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) throw new OllamaProviderError('INVALID_USAGE', rawResponse)
      let data: T
      try { data = JSON.parse(value.message.content) } catch { throw new OllamaProviderError('INVALID_JSON', rawResponse) }
      // JSON/schema prompting is not scientific validation; existing runner checks stay intact.
      const result = {
        data, provider: 'ollama', model: value.model, stage: request.stage,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        latencyMs: performance.now() - started,
        costUsd: 0, // Local API inference charge only, NOT total operating/electricity cost.
      } as OllamaJsonCompletion<T>
      Object.defineProperty(result, 'rawResponse', { value: rawResponse, enumerable: false })
      return result
    }
    try {
      return await Promise.race([transport(), deadline])
    } catch (error) {
      this.halted = true
      controller.abort()
      void reader?.cancel().catch(() => undefined)
      if (error instanceof OllamaProviderError) throw error
      throw new OllamaProviderError('TRANSPORT_ERROR', raw(), error)
    } finally {
      clearTimeout(timer)
    }
  }
}
