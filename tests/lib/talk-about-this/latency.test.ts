import { describe, expect, it } from 'vitest'
import { firstForwardedDeltaMs } from '@/lib/talk-about-this/latency'
import { telemetryForActivity } from '@/lib/talk-about-this/latency'

describe('firstForwardedDeltaMs', () => {
  it('assigns TTFT only to the first forwarded model delta, not activity or tool events', () => {
    let ttftMs: number | null = null
    for (const event of ['activity', 'tool-start', 'tool-complete', 'delta', 'delta'] as const) {
      ttftMs = firstForwardedDeltaMs(ttftMs, event, 1_000, event === 'delta' ? 1_450 : 1_200)
    }

    expect(ttftMs).toBe(450)
  })
  it('forwards only finite stage timestamps in tool activity telemetry', () => {
    expect(telemetryForActivity({
      embeddingStartedAt: 10,
      embeddingFinishedAt: 20,
      rpcStartedAt: Number.NaN,
      rpcFinishedAt: 40,
    })).toEqual({
      embeddingStartedAt: 10,
      embeddingFinishedAt: 20,
      rpcFinishedAt: 40,
    })
  })

})

