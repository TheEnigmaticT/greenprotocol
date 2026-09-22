import { describe, expect, it } from 'vitest'
import {
  integerTimeoutMs,
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
})
