import { describe, expect, it } from 'vitest'
import { integerTimeoutMs } from '@/lib/talk-about-this/agent'

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
