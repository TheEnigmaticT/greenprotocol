import { MAX_PROTOCOL_CHARS, MIN_PROTOCOL_CHARS } from '@/lib/protocol-limits'

/**
 * Stable machine-readable error codes shared by the API routes and the UI.
 * The code is the contract; the wording lives only in {@link humanizeError}.
 */
export const ERROR_CODES = [
  'not_chemistry',
  'run_limit_reached',
  'protocol_too_short',
  'protocol_too_long',
  'invalid_request',
  'quota_unavailable',
  'provider_auth',
  'provider_rate_limit',
  'provider_unavailable',
  'analysis_incomplete',
  'persist_failed',
  'unauthorized',
  'chemistry_service_unavailable',
  'invalid_analysis',
  'scoring_failed',
  'analysis_not_found',
  'analysis_load_failed',
  'save_conflict',
  'save_failed',
  'feedback_failed',
  'chat_unavailable',
  'unknown',
] as const

export type ErrorCode = typeof ERROR_CODES[number]

/** What the person should do next; the UI picks the matching affordance. */
export type HumanErrorAction = 'retry' | 'edit-protocol' | 'sign-in' | 'wait' | 'contact' | 'chat' | 'none'

export interface HumanError {
  code: ErrorCode
  title: string
  message: string
  action: HumanErrorAction
}

/** Numbers that make a message concrete. Anything else is ignored, never echoed. */
export interface HumanErrorContext {
  /** Analyses the account may run in total. */
  limit?: number
  minChars?: number
  maxChars?: number
  actualChars?: number
}

export interface HumanizeErrorInput {
  code?: string
  /** Raw detail. Only used to classify when no code is available; never shown. */
  message?: string
  status?: number
  context?: HumanErrorContext
}

const CONTACT = 'hello@greenchemistry.ai'

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
}

function count(value: number) {
  return value.toLocaleString('en-US')
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'invalid_request',
  401: 'unauthorized',
  429: 'provider_rate_limit',
  503: 'provider_unavailable',
}

const MESSAGE_PATTERNS: Array<[RegExp, ErrorCode]> = [
  [/rate.?limit|too many requests/i, 'provider_rate_limit'],
  [/authentication|api key/i, 'provider_auth'],
  [/overloaded|unavailable|timed? ?out|timeout/i, 'provider_unavailable'],
]

function classify(input: HumanizeErrorInput): ErrorCode {
  if (isErrorCode(input.code)) return input.code
  if (input.status !== undefined && input.status in STATUS_CODES) return STATUS_CODES[input.status]
  if (input.message) {
    for (const [pattern, code] of MESSAGE_PATTERNS) {
      if (pattern.test(input.message)) return code
    }
  }
  return 'unknown'
}

const COPY: Record<Exclude<ErrorCode, 'run_limit_reached' | 'protocol_too_short' | 'protocol_too_long'>, Omit<HumanError, 'code'>> = {
  not_chemistry: {
    title: "This doesn't look like a chemistry procedure",
    message: "We couldn't find any reagents, amounts or steps to analyze. Paste a lab procedure that lists the materials and what you do with them, or try one of the examples.",
    action: 'edit-protocol',
  },
  invalid_request: {
    title: "We couldn't read that request",
    message: 'Reload the page and try again. Your procedure text is safe in the box until you leave the page.',
    action: 'retry',
  },
  quota_unavailable: {
    title: "We couldn't start your analysis",
    message: 'Something went wrong on our side before the analysis began. Please try again in a minute.',
    action: 'retry',
  },
  provider_auth: {
    title: "The analysis service isn't available right now",
    message: `This is a problem on our side, not with your procedure. Please try again later, and contact us at ${CONTACT} if it continues.`,
    action: 'contact',
  },
  provider_rate_limit: {
    title: "We're busy right now",
    message: 'Many analyses are running at once. Wait a minute and try again; your procedure is still in the box.',
    action: 'wait',
  },
  provider_unavailable: {
    title: "The analysis didn't finish",
    message: 'Our analysis engine had a temporary problem. Try again in a few minutes; your procedure is still here.',
    action: 'retry',
  },
  analysis_incomplete: {
    title: "We couldn't complete this analysis",
    message: `The analysis stopped before every part was finished, so it wasn't saved. Try again. If it keeps happening, shorten or simplify the procedure, or contact us at ${CONTACT}.`,
    action: 'retry',
  },
  persist_failed: {
    title: "We finished the analysis but couldn't save it",
    message: `Please run it again. If it keeps happening, contact us at ${CONTACT}.`,
    action: 'retry',
  },
  unauthorized: {
    title: 'Please sign in again',
    message: 'Your session has expired. Sign in and you can pick up where you left off.',
    action: 'sign-in',
  },
  chemistry_service_unavailable: {
    title: "We can't reach our chemical reference data",
    message: 'Scoring needs reference data for each material, and it is unreachable right now. This is usually temporary; retry scoring in a few minutes.',
    action: 'wait',
  },
  invalid_analysis: {
    title: "We couldn't re-score this analysis",
    message: `The saved analysis is missing information that scoring needs. Run the analysis again from your procedure, or contact us at ${CONTACT}.`,
    action: 'contact',
  },
  scoring_failed: {
    title: "Scoring didn't finish",
    message: 'We reached the reference data but could not produce a grade this time. Retry scoring. If it keeps failing, use Chat about this or contact us.',
    action: 'chat',
  },
  analysis_not_found: {
    title: "We couldn't find that analysis",
    message: 'It may have been deleted, or it belongs to a different account. Go back to the dashboard to find it.',
    action: 'none',
  },
  analysis_load_failed: {
    title: "We couldn't open that analysis",
    message: 'Something went wrong on our side. Refresh the page to try again. Your analysis has not been lost.',
    action: 'retry',
  },
  save_conflict: {
    title: 'This analysis was changed somewhere else',
    message: "Reload the page to see the latest version before making more changes. Changes you made here since then weren't saved.",
    action: 'retry',
  },
  save_failed: {
    title: "Your changes weren't saved",
    message: "We couldn't save your recommendation decisions. Keep this page open and make the change again in a moment.",
    action: 'retry',
  },
  feedback_failed: {
    title: "We couldn't save your feedback",
    message: 'Please try again in a moment.',
    action: 'retry',
  },
  chat_unavailable: {
    title: "Chat isn't available right now",
    message: 'Please try again in a moment. Your analysis is not affected.',
    action: 'retry',
  },
  unknown: {
    title: 'Something went wrong',
    message: `We couldn't complete that. Please try again, and contact us at ${CONTACT} if it keeps happening.`,
    action: 'retry',
  },
}

function lengthDetail(context: HumanErrorContext | undefined, limit: number, direction: 'min' | 'max'): string {
  const actual = positiveInteger(context?.actualChars)
  if (actual === null) return ''
  return direction === 'min'
    ? ` Yours is ${count(actual)} (we need at least ${count(limit)}).`
    : ` Yours is ${count(actual)}.`
}

/**
 * The only place user-facing error wording is decided. Never returns raw
 * exception text, env var names, vendor or model names, HTTP status codes,
 * tool names or database messages.
 */
export function humanizeError(input: HumanizeErrorInput): HumanError {
  const code = classify(input)
  const context = input.context

  if (code === 'run_limit_reached') {
    const limit = positiveInteger(context?.limit)
    return {
      code,
      title: limit === null ? "You've used all of your available analyses" : `You've used all ${count(limit)} of your available analyses`,
      message: `Contact us at ${CONTACT} to unlock more.`,
      action: 'contact',
    }
  }

  if (code === 'protocol_too_short') {
    const min = positiveInteger(context?.minChars) ?? MIN_PROTOCOL_CHARS
    return {
      code,
      title: 'Add a little more detail',
      message: `We need enough of the procedure to find the materials and steps.${lengthDetail(context, min, 'min')} Paste the full procedure, or try one of the examples.`,
      action: 'edit-protocol',
    }
  }

  if (code === 'protocol_too_long') {
    const max = positiveInteger(context?.maxChars) ?? MAX_PROTOCOL_CHARS
    return {
      code,
      title: 'That procedure is too long to analyze',
      message: `Procedures can be up to ${count(max)} characters.${lengthDetail(context, max, 'max')} Trim it, for example by removing appendices, spectra or repeated safety text, or analyze it in separate parts.`,
      action: 'edit-protocol',
    }
  }

  return { code, ...COPY[code] }
}

const CONTEXT_KEYS: readonly string[] = ['limit', 'minChars', 'maxChars', 'actualChars']

/** Reads the `code` and numeric context out of a failed response body, ignoring anything else it contains. */
export function parseErrorBody(body: unknown): { code?: string; context: HumanErrorContext } {
  if (typeof body !== 'object' || body === null) return { context: {} }
  return {
    code: 'code' in body && typeof body.code === 'string' ? body.code : undefined,
    context: Object.fromEntries(Object.entries(body).filter(([key, value]) => typeof value === 'number' && CONTEXT_KEYS.includes(key))),
  }
}

/** The JSON/SSE body for a failed request. `error` is already safe to show; clients should still key on `code`. */
export function humanErrorPayload(code: ErrorCode, context?: HumanErrorContext) {
  const human = humanizeError({ code, context })
  return { code, error: `${human.title}. ${human.message}`, ...context }
}

/** Carries a ready-to-show error through `throw` so callers never have to read an exception's text. */
export class HumanErrorException extends Error {
  readonly humanError: HumanError

  constructor(humanError: HumanError) {
    super(humanError.code)
    this.name = 'HumanErrorException'
    this.humanError = humanError
  }
}

/** Anything thrown becomes a HumanError; only exceptions built from one keep their wording. */
export function toHumanError(error: unknown, fallback: ErrorCode = 'unknown'): HumanError {
  if (error instanceof HumanErrorException) return error.humanError
  return humanizeError({ code: fallback })
}
