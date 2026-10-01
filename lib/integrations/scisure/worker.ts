import type { SupabaseClient } from '@supabase/supabase-js'

export type LeasedSciSureJob = {
  id: string
  leaseToken: string
  principalId: string
  principalKind: 'registered' | 'guest'
  ownerUserId: string | null
  /** Created before provider invocation so trace writes bind to this lease. */
  analysisRunId?: string
  /** Server-only client; guests intentionally leave this unset. */
  supabase?: SupabaseClient
  snapshotId: string
  sourceHash: string
  protocolText: string
}

export type SciSureWorkerStore = {
  lease(): Promise<LeasedSciSureJob | null>
  heartbeat?(input: { jobId: string; leaseToken: string }): Promise<boolean>
  complete(input: { jobId: string; leaseToken: string; analysisId?: string; analysisRunId?: string; result: unknown }): Promise<boolean>
  fail(input: { jobId: string; leaseToken: string; status: 'failed' | 'uncertain'; errorCode: string }): Promise<boolean>
}

type Analyze = (protocolText: string, context: { userId?: string; analysisRunId?: string; supabase?: SupabaseClient; retrievalScope: 'public-only' }) => Promise<unknown>

/** Processes exactly one already-leased job. Provider execution is never retried after a lost lease. */
export async function runOneSciSureJob(store: SciSureWorkerStore, analyze: Analyze): Promise<{ jobId?: string; status: 'idle' | 'completed' | 'uncertain' }> {
  const job = await store.lease()
  if (!job) return { status: 'idle' }
  let leaseLost = false
  const heartbeat = store.heartbeat ? setInterval(() => {
    void store.heartbeat?.({ jobId: job.id, leaseToken: job.leaseToken }).then((current) => { if (!current) leaseLost = true }).catch(() => { leaseLost = true })
  }, 60_000) : undefined
  try {
    const result = await analyze(job.protocolText, {
      userId: job.principalKind === 'registered' ? job.ownerUserId || undefined : undefined,
      analysisRunId: job.principalKind === 'registered' ? job.analysisRunId : undefined,
      supabase: job.principalKind === 'registered' ? job.supabase : undefined,
      retrievalScope: 'public-only',
    })
    if (leaseLost || !await store.complete({ jobId: job.id, leaseToken: job.leaseToken, result })) return { jobId: job.id, status: 'uncertain' }
    return { jobId: job.id, status: 'completed' }
  } catch (error) {
    const errorCode = error instanceof Error && /not chemistry/i.test(error.message) ? 'not_chemistry' : 'execution_failed'
    await store.fail({ jobId: job.id, leaseToken: job.leaseToken, status: 'uncertain', errorCode })
    return { jobId: job.id, status: 'uncertain' }
  } finally {
    if (heartbeat) clearInterval(heartbeat)
  }
}
