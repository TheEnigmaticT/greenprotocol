import { runDecomposedBenchmark } from './runner'
import type { DecomposedPilotCase } from './pilot'
import type { DecomposedBenchmarkProvider, JsonCompletionRequest } from './provider'

/** Trusted local experiment coordinator. Persistence must remain private.
 * Proposed text is never applied to a source or promoted to scientific approval.
 */
export async function runLocalP5Session(input: {
  fixture: DecomposedPilotCase
  workerModel: string
  auditorModel: string
  provider: DecomposedBenchmarkProvider
  persist(event: Record<string, unknown>): Promise<void>
}) {
  const started = Date.now()
  let queue: Promise<unknown> = Promise.resolve()
  let stopped = false
  let sequence = 0
  let attempts = 0
  const provider: DecomposedBenchmarkProvider = {
    completeJson<T>(request: JsonCompletionRequest) {
      const task = queue.then(async () => {
        if (stopped) throw new Error('SESSION_STOPPED')
        const id = ++sequence
        const role = request.model === input.auditorModel ? 'auditor' : 'worker'
        try {
          await input.persist({ kind: 'request', id, role, request })
          attempts++
          const response = await input.provider.completeJson<T>(request)
          await input.persist({ kind: 'response', id, role, response,
            rawResponse: 'rawResponse' in response ? response.rawResponse : null })
          return response
        } catch (error) {
          stopped = true
          await input.persist({ kind: 'failure', id, role, error: error instanceof Error ? error.message : 'UNKNOWN_FAILURE',
            rawResponse: error instanceof Error && 'rawResponse' in error ? error.rawResponse : null })
          throw error
        }
      })
      queue = task.then(() => undefined, () => undefined)
      return task
    },
  }
  try {
    const result = await runDecomposedBenchmark({ ...input.fixture, model: input.workerModel,
      provider, auditModel: input.auditorModel, auditProvider: provider })
    await queue
    const outcome = { status: 'completed' as const, applied: false, scientificAcceptance: 'unverified' as const,
      attempts, latencyMs: Date.now() - started, result }
    await input.persist({ kind: 'outcome', ...outcome })
    return outcome
  } catch (error) {
    stopped = true
    await queue
    const outcome = { status: 'failed' as const, applied: false, scientificAcceptance: 'unverified' as const,
      attempts, latencyMs: Date.now() - started, result: null,
      error: error instanceof Error ? error.message : 'UNKNOWN_FAILURE' }
    await input.persist({ kind: 'outcome', ...outcome })
    return outcome
  }
}
