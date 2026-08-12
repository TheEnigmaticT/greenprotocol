import { describe, expect, it } from 'vitest'
import { activityPayload, mergeActivityTelemetry } from '@/app/api/talk-about-this/[conversationId]/messages/route'

describe('tool-complete activity payload', () => {
  it('accepts long-lived monotonic stage timestamps while rejecting invalid snapshots', () => {
    expect(activityPayload({
      tool: 'search_scoped_literature_evidence',
      telemetry: {
        embeddingStartedAt: 60_001,
        embeddingFinishedAt: 60_002,
        rpcStartedAt: 60_003,
        rpcFinishedAt: 60_004,
      },
    })).toMatchObject({
      tool: 'search_scoped_literature_evidence',
      telemetry: {
        embeddingStartedAt: 60_001,
        embeddingFinishedAt: 60_002,
        rpcStartedAt: 60_003,
        rpcFinishedAt: 60_004,
      },
    })

    expect(activityPayload({
      tool: 'search_scoped_literature_evidence',
      telemetry: { embeddingStartedAt: 20, embeddingFinishedAt: 10, rpcStartedAt: 30 },
    }).telemetry).toBeUndefined()
  })

  it('keeps complete and aborted retrieval attempts as separate terminal snapshots', () => {
    let telemetry = mergeActivityTelemetry(
      { clock: 'performance.now', routeStartedAt: 5 },
      activityPayload({
        callId: 'first',
        tool: 'search_scoped_literature_evidence',
        status: 'ok',
        telemetry: { embeddingStartedAt: 10, embeddingFinishedAt: 20, rpcStartedAt: 30, rpcFinishedAt: 40 },
      }),
    )
    telemetry = mergeActivityTelemetry(telemetry, activityPayload({
      callId: 'second',
      tool: 'search_scoped_literature_evidence',
      status: 'unavailable',
      warnings: ['Literature evidence retrieval aborted'],
      telemetry: { embeddingStartedAt: 100 },
    }))

    expect(telemetry).toEqual({
      clock: 'performance.now',
      routeStartedAt: 5,
      retrievalAttempts: [
        {
          callId: 'first',
          status: 'complete',
          embeddingStartedAt: 10,
          embeddingFinishedAt: 20,
          rpcStartedAt: 30,
          rpcFinishedAt: 40,
        },
        {
          callId: 'second',
          status: 'aborted',
          embeddingStartedAt: 100,
        },
      ],
    })
  })
})
