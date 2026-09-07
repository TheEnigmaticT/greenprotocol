/**
 * Fail-closed structured JSON for the GreenProtoCol local pipeline.
 * Providers: loopback Ollama, or OpenRouter-hosted local-quality models.
 * When enabled, Anthropic must not be used for pipeline LLM stages.
 */
import { OLLAMA_PILOT_MODELS } from "@/lib/decomposed-benchmark/ollama-provider"

/** Exact Ollama artifact IDs installed for local Mac inference. */
export const LOCAL_OLLAMA_MODELS = OLLAMA_PILOT_MODELS

/**
 * OpenRouter IDs for models that could run under ~256GB locally.
 * Prefer these for speed when GCAI_LOCAL_PROVIDER=openrouter.
 */
export const OPENROUTER_LOCAL_QUALITY_MODELS = Object.freeze([
  "google/gemma-4-31b-it",
  "qwen/qwen3.8-27b",
  "qwen/qwen3.6-35b-a3b",
  "qwen/qwen3.6-27b",
] as const)

export const LOCAL_PIPELINE_MODELS = Object.freeze([
  ...LOCAL_OLLAMA_MODELS,
  ...OPENROUTER_LOCAL_QUALITY_MODELS,
] as const)

export type LocalProvider = "ollama" | "openrouter"

export interface LocalPipelineEnv {
  GCAI_LOCAL_PIPELINE?: string
  GCAI_LOCAL_PARSE?: string
  GCAI_LOCAL_MODEL?: string
  GCAI_LOCAL_PARSE_MODEL?: string
  GCAI_LOCAL_PROVIDER?: string
  OPENROUTER_API_KEY?: string
  OPENROUTER_BASE_URL?: string
}

export function isLocalPipelineEnabled(env: LocalPipelineEnv = process.env): boolean {
  return env.GCAI_LOCAL_PIPELINE === "1" || env.GCAI_LOCAL_PARSE === "1"
}

export function requireLocalPipelineModel(env: LocalPipelineEnv = process.env): string {
  const model = (env.GCAI_LOCAL_MODEL || env.GCAI_LOCAL_PARSE_MODEL || "").trim()
  if (!model || !(LOCAL_PIPELINE_MODELS as readonly string[]).includes(model)) {
    throw new Error("local_pipeline_configuration_invalid")
  }
  return model
}

export function resolveLocalProvider(env: LocalPipelineEnv = process.env): LocalProvider {
  const raw = (env.GCAI_LOCAL_PROVIDER || "").trim().toLowerCase()
  if (raw === "openrouter" || raw === "ollama") return raw
  const model = (env.GCAI_LOCAL_MODEL || env.GCAI_LOCAL_PARSE_MODEL || "").trim()
  if ((OPENROUTER_LOCAL_QUALITY_MODELS as readonly string[]).includes(model)) return "openrouter"
  return "ollama"
}

export interface LocalJsonCompletionOptions {
  system: string
  user: string
  schema: Record<string, unknown>
  model?: string
  label?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  numPredict?: number
  env?: LocalPipelineEnv
}

async function completeOllamaJson<T>(
  options: LocalJsonCompletionOptions & { model: string },
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 180_000
  const numPredict = options.numPredict ?? 4096
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.user },
        ],
        format: options.schema,
        stream: false,
        think: false,
        options: { temperature: 0, num_predict: numPredict, num_ctx: 32768 },
      }),
    })
    if (!response.ok) throw new Error("local_llm_http_failed")
    const data = await response.json() as {
      model?: string
      done?: boolean
      done_reason?: string
      message?: { role?: string; content?: string; tool_calls?: unknown }
    }
    if (
      data.model !== options.model
      || data.done !== true
      || data.done_reason !== "stop"
      || data.message?.role !== "assistant"
      || data.message?.tool_calls
      || typeof data.message?.content !== "string"
      || !data.message.content.trim()
    ) {
      throw new Error("local_llm_response_invalid")
    }
    return JSON.parse(data.message.content) as T
  } finally {
    clearTimeout(timer)
  }
}

type OpenRouterChoice = {
  finish_reason?: string | null
  native_finish_reason?: string | null
  message?: { content?: string | null }
}

type OpenRouterPayload = {
  provider?: string
  choices?: OpenRouterChoice[]
  usage?: {
    completion_tokens?: number
    completion_tokens_details?: { reasoning_tokens?: number }
    reasoning_tokens?: number
  }
}

type OpenRouterRequestMode = "json_schema" | "json_object"

function openRouterEmptyDiag(payload: OpenRouterPayload): {
  finishReason: string
  nativeFinishReason: string
  completionTokens: number
  reasoningTokens: number
  provider: string
  choicesLength: number
  suffix: string
} {
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const choice = choices[0]
  const finishReason = String(choice?.finish_reason ?? "unknown")
  const nativeFinishReason = String(choice?.native_finish_reason ?? "unknown")
  const completionTokens = Number(payload.usage?.completion_tokens ?? 0)
  const reasoningTokens = Number(
    payload.usage?.completion_tokens_details?.reasoning_tokens
      ?? payload.usage?.reasoning_tokens
      ?? 0,
  )
  const provider = String(payload.provider ?? "unknown")
  const choicesLength = choices.length
  const suffix =
    `finish_reason=${finishReason} reasoning=${reasoningTokens}/${completionTokens}`
    + ` choices=${choicesLength}`
  return {
    finishReason,
    nativeFinishReason,
    completionTokens,
    reasoningTokens,
    provider,
    choicesLength,
    suffix,
  }
}

/**
 * Hollow/empty OpenRouter 200: no choices, empty choices, or missing content
 * with completion_tokens===0 / missing usage (and any other missing content).
 */
function isHollowOrEmptyOpenRouter(
  payload: OpenRouterPayload,
  content: string | null,
): boolean {
  const choices = payload.choices
  if (!Array.isArray(choices) || choices.length === 0) return true
  if (content) return false
  if (payload.usage == null) return true
  if (Number(payload.usage.completion_tokens ?? 0) === 0) return true
  return true
}

function stripMarkdownJsonFences(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function parseOpenRouterJsonContent<T>(raw: string): T {
  return JSON.parse(stripMarkdownJsonFences(raw)) as T
}

async function completeOpenRouterJson<T>(
  options: LocalJsonCompletionOptions & { model: string; env: LocalPipelineEnv },
): Promise<T> {
  const apiKey = (options.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || "").trim()
  if (!apiKey) throw new Error("local_llm_openrouter_key_missing")
  if (!(OPENROUTER_LOCAL_QUALITY_MODELS as readonly string[]).includes(options.model)) {
    throw new Error("local_pipeline_configuration_invalid")
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 180_000
  const base = (options.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "")
  const baseMaxTokens = options.numPredict ?? 8192

  const requestOnce = async (
    maxTokens: number,
    mode: OpenRouterRequestMode,
  ): Promise<{ content: string | null; payload: OpenRouterPayload }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const systemContent = mode === "json_object"
      ? `${options.system}\nReturn ONLY a JSON object matching the required keys; no markdown.`
      : options.system
    const body: Record<string, unknown> = {
      model: options.model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: options.user },
      ],
      reasoning: { effort: "low" },
    }
    if (mode === "json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "local_pipeline_result",
          strict: true,
          schema: options.schema,
        },
      }
      // Prefer providers that honor structured params, but allow fallback if one returns junk.
      body.provider = { require_parameters: true, allow_fallbacks: true }
    } else {
      body.response_format = { type: "json_object" }
      body.provider = { allow_fallbacks: true }
    }
    try {
      const response = await fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const errBody = await response.text().catch(() => "")
        throw new Error(`local_llm_openrouter_http_${response.status}:${errBody.slice(0, 200)}`)
      }
      const payload = await response.json() as OpenRouterPayload
      const raw = payload.choices?.[0]?.message?.content
      const content = typeof raw === "string" && raw.trim() ? raw : null
      return { content, payload }
    } finally {
      clearTimeout(timer)
    }
  }

  const first = await requestOnce(baseMaxTokens, "json_schema")
  if (!isHollowOrEmptyOpenRouter(first.payload, first.content) && first.content) {
    return parseOpenRouterJsonContent<T>(first.content)
  }

  const diag = openRouterEmptyDiag(first.payload)
  console.warn(
    `[local-llm] openrouter empty/hollow content: ${diag.suffix}`
      + ` native_finish_reason=${diag.nativeFinishReason}`
      + ` provider=${diag.provider}`,
  )

  // Retry once: json_object, allow_fallbacks, no require_parameters.
  const lengthOrReasoningHeavy =
    diag.finishReason === "length"
    || (diag.completionTokens > 0 && diag.reasoningTokens >= 0.8 * diag.completionTokens)
  const retryMax = lengthOrReasoningHeavy
    ? Math.min(baseMaxTokens * 2, 24576)
    : baseMaxTokens
  console.warn(
    `[local-llm] openrouter empty/hollow: retrying once with json_object max_tokens=${retryMax}`
      + (lengthOrReasoningHeavy ? " (length/reasoning-heavy)" : ""),
  )
  const second = await requestOnce(retryMax, "json_object")
  if (second.content) {
    return parseOpenRouterJsonContent<T>(second.content)
  }
  const retryDiag = openRouterEmptyDiag(second.payload)
  console.warn(
    `[local-llm] openrouter empty after retry: ${retryDiag.suffix}`
      + ` native_finish_reason=${retryDiag.nativeFinishReason}`
      + ` provider=${retryDiag.provider}`,
  )
  throw new Error(
    `local_llm_openrouter_empty:${retryDiag.suffix}`
      + (retryDiag.choicesLength === 0 ? ":choices_empty" : ""),
  )
}

/**
 * One bounded structured JSON completion. No Anthropic fallback.
 */
export async function completeLocalJson<T = unknown>(
  options: LocalJsonCompletionOptions,
): Promise<T> {
  const env = options.env ?? process.env
  const model = options.model ?? requireLocalPipelineModel(env)
  if (!(LOCAL_PIPELINE_MODELS as readonly string[]).includes(model)) {
    throw new Error("local_pipeline_configuration_invalid")
  }
  const provider = resolveLocalProvider({ ...env, GCAI_LOCAL_MODEL: model })
  const label = options.label ?? "local-json"
  const started = Date.now()
  console.log(`[local-llm] ${label}: starting (provider=${provider}, model=${model})`)
  try {
    const result = provider === "openrouter"
      ? await completeOpenRouterJson<T>({ ...options, model, env })
      : await completeOllamaJson<T>({ ...options, model })
    console.log(`[local-llm] ${label}: completed in ${((Date.now() - started) / 1000).toFixed(1)}s`)
    return result
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("local_llm_timeout")
    }
    throw err
  }
}
