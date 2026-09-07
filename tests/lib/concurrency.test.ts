import { describe, expect, it } from 'vitest'
import { mapSettledWithConcurrency } from '@/lib/concurrency'

describe('mapSettledWithConcurrency', () => {
  it('preserves input order and bounds concurrency', async () => {
    let inflight = 0
    let maxInflight = 0
    const started: number[] = []

    const results = await mapSettledWithConcurrency(
      [10, 20, 30, 40, 50],
      2,
      async (ms, index) => {
        started.push(index)
        inflight++
        maxInflight = Math.max(maxInflight, inflight)
        await new Promise((r) => setTimeout(r, ms))
        inflight--
        return index * 2
      },
    )

    expect(maxInflight).toBeLessThanOrEqual(2)
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([0, 2, 4, 6, 8])
    expect(started[0]).toBe(0)
    expect(started[1]).toBe(1)
  })

  it('captures rejections without aborting siblings', async () => {
    const results = await mapSettledWithConcurrency([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error('boom')
      return n
    })
    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 })
    expect(results[1].status).toBe('rejected')
    expect(results[2]).toEqual({ status: 'fulfilled', value: 3 })
  })
})
