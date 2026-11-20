import type { ErrorCode } from '@/lib/errors/humanize'

/**
 * A failure with a stable, user-presentable code. `message` keeps the raw
 * detail for server logs and operational alerts and is never sent to a browser.
 */
export class AnalysisError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, detail: string) {
    super(detail)
    this.name = 'AnalysisError'
    this.code = code
  }
}

const CODE_BY_ERROR_NAME: Record<string, ErrorCode> = {
  QwenTransportError: 'provider_unavailable',
  CompatibleModelConfigurationError: 'provider_auth',
  NotChemistryError: 'not_chemistry',
}

/** Maps anything thrown while analyzing a protocol to a stable code. Raw text is only inspected, never returned. */
export function classifyAnalysisFailure(error: unknown): ErrorCode {
  if (error instanceof AnalysisError) return error.code
  if (typeof error !== 'object' || error === null) return 'unknown'

  const named = 'name' in error && typeof error.name === 'string' ? CODE_BY_ERROR_NAME[error.name] : undefined
  if (named) return named

  const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined
  const message = 'message' in error && typeof error.message === 'string' ? error.message : ''

  if (status === 401 || status === 403 || /authentication|api key/i.test(message)) return 'provider_auth'
  if (status === 429) return 'provider_rate_limit'
  if (status !== undefined && (status >= 500 || status === 408)) return 'provider_unavailable'
  if (/Claude API call failed|did not return a tool_use/i.test(message)) return 'provider_unavailable'
  return 'unknown'
}
