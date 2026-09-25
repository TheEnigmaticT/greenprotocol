import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  integerTimeoutMs,
  MESSAGES_ROUTE_MAX_DURATION_S,
  TOOL_CALL_TIMEOUT_MS,
  TOOL_LOOP_TIMEOUT_MS,
} from '@/lib/talk-about-this/agent'

describe('integerTimeoutMs', () => {
  it('floors performance.now deltas so AbortSignal.timeout accepts them', () => {
    expect(integerTimeoutMs(4950.9656010000035)).toBe(4950)
    expect(() => AbortSignal.timeout(integerTimeoutMs(4950.9656010000035))).not.toThrow()
  })

  it('clamps non-positive and non-finite values to 0', () => {
    expect(integerTimeoutMs(0.4)).toBe(0)
    expect(integerTimeoutMs(-12)).toBe(0)
    expect(integerTimeoutMs(Number.NaN)).toBe(0)
  })
})

describe('scoped chat turn budgets', () => {
  it('keeps the turn budget above one full per-tool dispatch plus answer headroom', () => {
    // Regression: TOOL_CALL was raised to 10s while TOOL_LOOP stayed at 12s,
    // so a timed-out PubChem call could abort the final answer and sibling tools.
    expect(TOOL_CALL_TIMEOUT_MS).toBe(10_000)
    expect(TOOL_LOOP_TIMEOUT_MS).toBeGreaterThanOrEqual(TOOL_CALL_TIMEOUT_MS + 30_000)
  })

  it('keeps the turn budget well below the messages route Vercel maxDuration', () => {
    // Regression (2026-09-25): budget and maxDuration were both 60s, so Vercel
    // killed the request before the graceful turn deadline could return partial
    // results. Require at least 60s of headroom for pre-loop work and persistence.
    const routeSource = readFileSync(
      join(process.cwd(), 'app/api/talk-about-this/[conversationId]/messages/route.ts'),
      'utf8',
    )
    const match = routeSource.match(/export const maxDuration = (\d+)/)
    expect(match).not.toBeNull()
    const routeMaxDurationS = Number(match![1])
    expect(routeMaxDurationS).toBe(MESSAGES_ROUTE_MAX_DURATION_S)
    expect(TOOL_LOOP_TIMEOUT_MS + 60_000).toBeLessThanOrEqual(routeMaxDurationS * 1000)
  })
})
