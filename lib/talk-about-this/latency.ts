import type { ChatLifecycleEvent } from '@/lib/talk-about-this/agent'

/** Returns the first model-text latency only; lifecycle/tool activity never establishes TTFT. */
export function firstForwardedDeltaMs(
  current: number | null,
  event: ChatLifecycleEvent,
  startedAt: number,
  occurredAt: number,
): number | null {
  if (current !== null || event !== 'delta') return current
  return Math.max(0, occurredAt - startedAt)
}

/** Limits activity telemetry to finite public stage times. */
export function telemetryForActivity(data: {
  embeddingStartedAt?: unknown
  embeddingFinishedAt?: unknown
  rpcStartedAt?: unknown
  rpcFinishedAt?: unknown
}): Record<string, number> {
  const timing: Record<string, number> = {}
  for (const key of ['embeddingStartedAt', 'embeddingFinishedAt', 'rpcStartedAt', 'rpcFinishedAt'] as const) {
    const value = data[key]
    if (typeof value === 'number' && Number.isFinite(value)) timing[key] = value
  }
  return timing
}
