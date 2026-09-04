import { notifySentinelErrors } from '@/lib/operational-alerts'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export const maxDuration = 60

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const windowEnding = now.toISOString().slice(0, 10)
  const admin = createAdminClient()
  const { data: runs, error: runsError } = await admin
    .from('gpc_analysis_runs')
    .select('id')
    .eq('run_source', 'sentinel')
    .gte('created_at', windowStart)
  if (runsError) return NextResponse.json({ error: runsError.message }, { status: 500 })

  const runIds = (runs || []).map(run => run.id)
  if (runIds.length === 0) return NextResponse.json({ ok: true, errors: 0 })

  const { data: traces, error: tracesError } = await admin
    .from('gpc_analysis_traces')
    .select('analysis_run_id, error_message')
    .in('analysis_run_id', runIds)
    .not('error_message', 'is', null)
  if (tracesError) return NextResponse.json({ error: tracesError.message }, { status: 500 })

  const errors = (traces || [])
    .filter(trace => trace.analysis_run_id && trace.error_message)
    .map(trace => ({ runId: trace.analysis_run_id!, errorMessage: trace.error_message! }))
  if (errors.length === 0) return NextResponse.json({ ok: true, errors: 0 })

  const { error: claimError } = await admin
    .from('gpc_operational_alert_dispatches')
    .insert({ alert_type: 'sentinel-errors', window_ending: windowEnding })
  if (claimError?.code === '23505') return NextResponse.json({ ok: true, alreadyDispatched: true })
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 })

  const delivered = await notifySentinelErrors(windowEnding, errors)
  if (!delivered) {
    await admin
      .from('gpc_operational_alert_dispatches')
      .delete()
      .eq('alert_type', 'sentinel-errors')
      .eq('window_ending', windowEnding)
    return NextResponse.json({ error: 'Slack delivery failed' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, errors: errors.length })
}
