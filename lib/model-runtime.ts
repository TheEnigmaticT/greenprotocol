export const OPENROUTER_COMPATIBLE_BASE_URL = 'https://openrouter.ai/api/v1'
export const LEGACY_QWEN_MODEL = 'qwen/qwen3.8-27b'

export interface CompatibleModelRuntime {
  baseURL: string
  model: string
  apiKey: string
  source: 'candidate' | 'legacy-qwen-parity'
}

export class CompatibleModelConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompatibleModelConfigurationError'
  }
}

function configuredValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim()
  return value || undefined
}

function validateVersionedCompatibleBaseURL(baseURL: string): void {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    throw new CompatibleModelConfigurationError('GCAI_LLM_BASE_URL must be an absolute http(s) URL ending in /v1')
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('/v1')
  ) {
    throw new CompatibleModelConfigurationError('GCAI_LLM_BASE_URL must be an absolute http(s) URL ending in /v1')
  }
}

export function isCandidateEngineSelected(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GCAI_ENGINE_CANDIDATE === '1'
}

/**
 * Resolve only the model runtime selected for this call. Candidate mode has no
 * provider discovery or credential fallback beyond OpenRouter's explicit key.
 */
export function resolveQwenModelRuntime(env: NodeJS.ProcessEnv = process.env): CompatibleModelRuntime {
  if (!isCandidateEngineSelected(env)) {
    const apiKey = configuredValue(env, 'OPENROUTER_API_KEY')
    if (!apiKey) {
      throw new CompatibleModelConfigurationError('OPENROUTER_API_KEY is not configured')
    }
    return {
      baseURL: OPENROUTER_COMPATIBLE_BASE_URL,
      model: LEGACY_QWEN_MODEL,
      apiKey,
      source: 'legacy-qwen-parity',
    }
  }

  const baseURL = configuredValue(env, 'GCAI_LLM_BASE_URL')
  if (!baseURL) {
    throw new CompatibleModelConfigurationError('GCAI_LLM_BASE_URL is required when GCAI_ENGINE_CANDIDATE=1')
  }
  validateVersionedCompatibleBaseURL(baseURL)

  const model = configuredValue(env, 'GCAI_LLM_MODEL')
  if (!model) {
    throw new CompatibleModelConfigurationError('GCAI_LLM_MODEL is required when GCAI_ENGINE_CANDIDATE=1')
  }

  const apiKey = configuredValue(env, 'GCAI_LLM_API_KEY') ?? (
    baseURL === OPENROUTER_COMPATIBLE_BASE_URL
      ? configuredValue(env, 'OPENROUTER_API_KEY')
      : undefined
  )
  if (!apiKey) {
    throw new CompatibleModelConfigurationError('GCAI_LLM_API_KEY is required for the selected candidate endpoint')
  }

  return { baseURL, model, apiKey, source: 'candidate' }
}
