/**
 * Small concurrency helpers for pipeline stages that may run serial (Ollama)
 * or bounded-parallel (OpenRouter / remote).
 */

/**
 * Map items with a concurrency limit; returns Promise.allSettled-style results
 * in input order.
 */
export async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const n = items.length
  if (n === 0) return []
  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, n))
  const results: PromiseSettledResult<R>[] = new Array(n)
  let nextIndex = 0

  async function runWorker(): Promise<void> {
    while (true) {
      const i = nextIndex++
      if (i >= n) return
      try {
        const value = await worker(items[i], i)
        results[i] = { status: 'fulfilled', value }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()))
  return results
}
