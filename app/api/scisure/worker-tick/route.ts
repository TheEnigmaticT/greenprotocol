import { NextResponse } from 'next/server'
import { analyzeProtocol, NotChemistryError } from '@/lib/pipeline'
import { resolveQwenModelRuntime } from '@/lib/model-runtime'
import { createAdminClient } from '@/lib/supabase/admin'
import { runOneSciSureJob, type LeasedSciSureJob, type SciSureWorkerStore } from '@/lib/integrations/scisure/worker'

export const maxDuration = 300

const LEASE_SECONDS = 900

function deny(message: string, status = 401) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

/** Vercel Cron entry point. Processes at most one queued SciSure job per tick.
 *  Schedules a tick every minute via vercel.json; the same leased-job RPC used
 *  by the Cloud Run Job (scripts/run-scisure-worker.ts) guarantees no double
 *  processing even if both run. Forks/skip-locks in gpc_lease_scisure_job make
 *  this safe under overlap. */
export async function GET(request: Request) {
  // Vercel Cron sends an Authorization header; reject anything else.
  const auth = request.headers.get('authorization') || ''
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return deny('CRON_SECRET is not configured.', 503)
  if (auth !== `Bearer ${cronSecret}`) return deny('Unauthorized cron invocation.', 401)

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SCISURE_NONCE_HASH_KEY) {
    return NextResponse.json({ ok: false, error: 'Missing Supabase configuration for the SciSure worker tick.' }, { status: 503 })
  }

  // Fail before leasing any work if the explicitly selected worker route cannot execute.
  try {
    resolveQwenModelRuntime()
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Worker route is misconfigured.' }, { status: 503 })
  }

  const admin = createAdminClient()
  let leased: LeasedSciSureJob | null = null
  let analysisRunId: string | undefined
  const store: SciSureWorkerStore = {
    async lease() {
      const { data, error } = await admin.rpc('gpc_lease_scisure_job' as never, { p_lease_seconds: LEASE_SECONDS } as never)
      if (error) throw error
      const row = Array.isArray(data) ? data[0] as Record<string, unknown> : undefined
      if (!row || typeof row.lease_token !== 'string' || typeof row.source_hash !== 'string') return null
      leased = {
        id: String(row.job_id), leaseToken: row.lease_token, principalId: String(row.principal_id), principalKind: row.principal_kind === 'registered' ? 'registered' : 'guest',
        ownerUserId: typeof row.owner_user_id === 'string' ? row.owner_user_id : null, snapshotId: String(row.snapshot_id), sourceHash: row.source_hash, protocolText: String(row.protocol_text),
      }
      if (leased.principalKind === 'registered' && leased.ownerUserId) {
        const { data: run, error: runError } = await admin.from('gpc_analysis_runs').insert({ user_id: leased.ownerUserId, status: 'running', run_source: 'scisure' }).select('id').single()
        if (runError || !run) throw new Error(runError?.message || 'Could not create SciSure analysis run.')
        analysisRunId = run.id
        const { error: linkError } = await admin.from('gpc_scisure_jobs').update({ analysis_run_id: analysisRunId }).eq('id', leased.id).eq('lease_token', leased.leaseToken).eq('status', 'running')
        if (linkError) throw new Error(linkError.message)
        leased.analysisRunId = analysisRunId
        leased.supabase = admin
      }
      return leased
    },
    async heartbeat(input) {
      const { data, error } = await admin.rpc('gpc_heartbeat_scisure_job' as never, { p_job_id: input.jobId, p_lease_token: input.leaseToken, p_lease_seconds: LEASE_SECONDS } as never)
      if (error) throw error
      return data === true
    },
    async complete(input) {
      const job = leased
      if (!job || job.id !== input.jobId || job.leaseToken !== input.leaseToken) throw new Error('Worker lost leased job state.')
      let analysisId: string | undefined
      if (job.principalKind === 'registered' && job.ownerUserId) {
        const { data: analysis, error: analysisError } = await admin.from('gpc_analyses').insert({
          user_id: job.ownerUserId, protocol_text: job.protocolText, analysis_result: input.result, impact_delta: null, source_snapshot_hash: job.sourceHash,
        }).select('id').single()
        if (analysisError || !analysis) throw new Error(analysisError?.message || 'Could not persist registered analysis.')
        analysisId = analysis.id
        if (!analysisRunId) throw new Error('SciSure run provenance is missing.')
        const { error: runError } = await admin.from('gpc_analysis_runs').update({ analysis_id: analysisId, status: 'completed', completed_at: new Date().toISOString() }).eq('id', analysisRunId).eq('status', 'running')
        if (runError) throw new Error(runError.message)
      }
      const { data, error } = await admin.rpc('gpc_complete_scisure_job' as never, {
        p_job_id: input.jobId, p_lease_token: input.leaseToken, p_analysis_id: analysisId ?? null, p_analysis_run_id: analysisRunId ?? null, p_result: input.result,
      } as never)
      if (error) throw error
      return data === true
    },
    async fail(input) {
      const { data, error } = await admin.rpc('gpc_fail_scisure_job' as never, {
        p_job_id: input.jobId, p_lease_token: input.leaseToken, p_status: input.status, p_error_code: input.errorCode,
      } as never)
      if (error) throw error
      return data === true
    },
  }
  try {
    const outcome = await runOneSciSureJob(store, async (protocolText, context) => analyzeProtocol(protocolText, undefined, context))
    return NextResponse.json({ ok: true, ...outcome })
  } catch (error) {
    if (error instanceof NotChemistryError) {
      return NextResponse.json({ ok: false, error: 'not_chemistry' }, { status: 200 })
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Worker tick failed.' }, { status: 500 })
  }
}
