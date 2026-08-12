import { describe, expect, it } from 'vitest'
import { activityPayload, mergeActivityTelemetry } from '@/app/api/talk-about-this/[conversationId]/messages/route'

describe('tool-complete activity payload', () => {
  it('forwards only bounded finite stage telemetry', () => {
    expect(activityPayload({
      tool: 'search_scoped_literature_evidence',
      telemetry: {
        embeddingStartedAt: 10,
        embeddingFinishedAt: Number.NaN,
        rpcStartedAt: 30,
        rpcFinishedAt: 60_001,
      },
    })).toMatchObject({
      tool: 'search_scoped_literature_evidence',
      telemetry: { embeddingStartedAt: 10, rpcStartedAt: 30 },
    })
  })

  it('retains safe tool-complete telemetry for terminal persistence', () => {
    expect(mergeActivityTelemetry(
      { clock: 'performance.now', routeStartedAt: 5 },
      activityPayload({
        telemetry: { embeddingStartedAt: 10, embeddingFinishedAt: 20, rpcStartedAt: 30 },
      }),
    )).toEqual({
      clock: 'performance.now',
      routeStartedAt: 5,
      embeddingStartedAt: 10,
      embeddingFinishedAt: 20,
      rpcStartedAt: 30,
    })
  })
})
