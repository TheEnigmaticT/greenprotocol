import { describe, expect, it } from 'vitest'
import {
  ERROR_CODES,
  HumanErrorException,
  humanErrorPayload,
  humanizeError,
  parseErrorBody,
  toHumanError,
} from '@/lib/errors/humanize'

const INTERNALS = /ANTHROPIC|API_KEY|environment variable|Claude|Anthropic|Qwen|OpenRouter|stop_reason|tool_use|return_result|undefined|null|NaN|Postgres|Supabase|\bRPC\b|\b[45]\d\d\b|[a-z]+_[a-z]+/

describe('humanizeError', () => {
  it.each(ERROR_CODES)('never exposes internals for %s, with or without context', (code) => {
    for (const context of [undefined, {}, { limit: 10, minChars: 20, maxChars: 50_000, actualChars: 61_234 }]) {
      const human = humanizeError({ code, context })
      expect(`${human.title} ${human.message}`).not.toMatch(INTERNALS)
      expect(human.title.length).toBeGreaterThan(0)
      expect(human.message.length).toBeGreaterThan(0)
      expect(human.code).toBe(code)
    }
  })

  it('shows the real analysis limit instead of "undefined"', () => {
    const human = humanizeError({ code: 'run_limit_reached', context: { limit: 10 } })
    expect(human.title).toBe("You've used all 10 of your available analyses")
    expect(human.message).toContain('hello@greenchemistry.ai')
    expect(human.action).toBe('contact')
  })

  it.each([undefined, 0, -3, Number.NaN, 2.5, Infinity])('omits a limit that is not a positive whole number (%s)', (limit) => {
    const human = humanizeError({ code: 'run_limit_reached', context: { limit } })
    expect(human.title).toBe("You've used all of your available analyses")
  })

  it('states the maximum and the current length for an over-long procedure', () => {
    const human = humanizeError({ code: 'protocol_too_long', context: { maxChars: 50_000, actualChars: 61_234 } })
    expect(human.message).toContain('50,000')
    expect(human.message).toContain('61,234')
    expect(human.action).toBe('edit-protocol')
  })

  it('states the minimum and the current length for a too-short procedure', () => {
    const human = humanizeError({ code: 'protocol_too_short', context: { minChars: 20, actualChars: 7 } })
    expect(human.message).toContain('7')
    expect(human.message).toContain('at least 20')
  })

  it('falls back to the shared limits when the server did not send them', () => {
    expect(humanizeError({ code: 'protocol_too_long' }).message).toContain('50,000')
  })

  it('never echoes raw exception text when classifying by message', () => {
    const raw = 'Failed to complete analysis audit run: duplicate key value violates unique constraint "gpc_analysis_runs_pkey"'
    const human = humanizeError({ message: raw })
    expect(human.code).toBe('unknown')
    expect(`${human.title} ${human.message}`).not.toContain('duplicate key')
  })

  it('classifies legacy provider failures without echoing the key name', () => {
    const human = humanizeError({ message: 'Anthropic API key is missing or invalid. Check ANTHROPIC_API_KEY environment variable.' })
    expect(human.code).toBe('provider_auth')
    expect(`${human.title} ${human.message}`).not.toMatch(/ANTHROPIC|key/i)
  })

  it('prefers an explicit code over the status and message', () => {
    expect(humanizeError({ code: 'not_chemistry', status: 500, message: 'rate limit' }).code).toBe('not_chemistry')
  })

  it('ignores a code it does not know and falls back to the status', () => {
    expect(humanizeError({ code: 'ECONNRESET', status: 429 }).code).toBe('provider_rate_limit')
    expect(humanizeError({ code: 'ECONNRESET' }).code).toBe('unknown')
  })

  it('tells a rate-limited person to wait, and an expired session to sign in', () => {
    expect(humanizeError({ code: 'provider_rate_limit' }).action).toBe('wait')
    expect(humanizeError({ code: 'unauthorized' }).action).toBe('sign-in')
  })

  it('tells an outage of the reference data apart from a scoring failure', () => {
    const outage = humanizeError({ code: 'chemistry_service_unavailable' })
    const failure = humanizeError({ code: 'scoring_failed' })
    expect(outage.message).not.toBe(failure.message)
    expect(outage.message).toMatch(/unreachable|can't reach/i)
  })
})

describe('humanErrorPayload', () => {
  it('carries the code, safe copy and the numbers the client needs', () => {
    expect(humanErrorPayload('run_limit_reached', { limit: 10 })).toEqual({
      code: 'run_limit_reached',
      error: "You've used all 10 of your available analyses. Contact us at hello@greenchemistry.ai to unlock more.",
      limit: 10,
    })
  })
})

describe('parseErrorBody', () => {
  it('reads the code and numeric context and ignores everything else', () => {
    expect(parseErrorBody({ code: 'protocol_too_long', error: 'text', maxChars: 50_000, actualChars: 60_000, stack: 'secret', limit: '10' })).toEqual({
      code: 'protocol_too_long',
      context: { maxChars: 50_000, actualChars: 60_000 },
    })
  })

  it.each([null, undefined, 'oops', 42])('tolerates a body that is not an object (%s)', (body) => {
    expect(parseErrorBody(body)).toEqual({ context: {} })
  })
})

describe('toHumanError', () => {
  it('keeps the wording of an exception built from a HumanError', () => {
    const human = humanizeError({ code: 'chemistry_service_unavailable' })
    expect(toHumanError(new HumanErrorException(human))).toBe(human)
  })

  it('replaces any other thrown value with the fallback copy, never its text', () => {
    const human = toHumanError(new Error('connect ECONNREFUSED 10.0.0.4:8000'), 'scoring_failed')
    expect(human.code).toBe('scoring_failed')
    expect(human.message).not.toContain('ECONNREFUSED')
  })
})
