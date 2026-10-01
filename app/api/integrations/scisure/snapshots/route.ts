import { NextResponse } from 'next/server'
import { parseSciSureAdmission } from '@/lib/integrations/scisure'
import { authorizeConnection, requireSciSureOrigin } from '@/lib/integrations/scisure/server'
import { hasUnlimitedAnalyses } from '@/lib/analysis-entitlements'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function bearer(request: Request) {
  const value = request.headers.get('authorization') || ''
  if (!value.startsWith('Bearer ') || value.length > 1024) throw new Error('Missing connection credential.')
  return value.slice(7)
}
function retention() { return new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString() }

export async function POST(request: Request) {
  try {
    const origin = requireSciSureOrigin(request.headers.get('x-gcai-scisure-origin'))
    const admission = parseSciSureAdmission(await request.json())
    const { admin, connection } = await authorizeConnection({ bridgeSessionId: admission.bridgeSessionId, credential: bearer(request), origin, nonce: admission.nonce })
    const { data: snapshot, error: snapshotError } = await admin.from('gpc_external_source_snapshots').upsert({
      principal_id: connection.principal_id, connection_id: connection.id, source_hash: admission.sourceHash, source: admission.source,
      protocol_text: admission.source.protocolText, delivery_email: admission.email.address || null, delivery_consent: admission.email.deliveryConsent,
      marketing_consent: admission.email.marketingConsent, consented_at: admission.email.address ? new Date().toISOString() : null, expires_at: retention(),
    }, { onConflict: 'connection_id,source_hash' }).select('id').single()
    if (snapshotError || !snapshot) throw new Error('Could not persist source snapshot.')
    if (admission.email.address) {
      const events = [admission.email.deliveryConsent && { purpose: 'delivery' }, admission.email.marketingConsent && { purpose: 'marketing' }].filter(Boolean).map((event) => ({ snapshot_id: snapshot.id, purpose: (event as { purpose: string }).purpose, address: admission.email.address, state: 'pending_configuration' }))
      if (events.length) await admin.from('gpc_scisure_email_events').upsert(events, { onConflict: 'snapshot_id,purpose' })
    }
    const limit = Number.parseInt(process.env.ANALYSIS_RUN_LIMIT || '10', 10)
    const normalizedLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : 10
    const { data: principal, error: principalError } = await admin.from('gpc_scisure_principals').select('kind, user_id, guest_subject_id').eq('id', connection.principal_id).maybeSingle()
    if (principalError || !principal) throw new Error('Integration principal is unavailable.')
    let registeredLimit: number | null = normalizedLimit
    if (principal.kind === 'registered') {
      if (!principal.user_id) throw new Error('Registered integration owner is unavailable.')
      const { data: identity, error: identityError } = await admin.auth.admin.getUserById(principal.user_id)
      if (identityError || !identity.user || identity.user.id !== principal.user_id || !identity.user.email_confirmed_at) {
        throw new Error('Registered integration owner could not be verified.')
      }
      // The service-only reservation RPC accepts NULL for an uncapped account.
      // Keep its audit ledger, ownership checks and idempotency intact. Never
      // derive entitlement from imported source or consent/delivery addresses.
      if (hasUnlimitedAnalyses(identity.user.email)) registeredLimit = null
    } else if (principal.kind !== 'guest') {
      throw new Error('Integration principal kind is unavailable.')
    }
    const { data: reservation, error: reservationError } = principal.kind === 'guest'
      ? await admin.rpc('gpc_reserve_scisure_guest_job' as never, {
        p_subject_id: principal.guest_subject_id, p_principal_id: connection.principal_id, p_snapshot_id: snapshot.id,
        p_idempotency_key: admission.requestId, p_limit: Math.min(normalizedLimit, Number.parseInt(process.env.SCISURE_GUEST_TRIAL_LIMIT || '1', 10) || 1),
      } as never)
      : await admin.rpc('gpc_reserve_scisure_job' as never, {
        p_principal_id: connection.principal_id, p_snapshot_id: snapshot.id, p_idempotency_key: admission.requestId, p_limit: registeredLimit,
      } as never)
    const row = Array.isArray(reservation) ? reservation[0] as { job_id?: string; replayed?: boolean } : undefined
    if (reservationError || !row?.job_id) throw new Error(reservationError?.message || 'Could not reserve analysis capacity.')
    return NextResponse.json({ version: 1, bridgeSessionId: connection.id, snapshotId: snapshot.id, sourceHash: admission.sourceHash, runId: row.job_id, status: 'queued', email: admission.email.address ? 'pending_configuration' : 'not_requested' }, { status: row.replayed ? 200 : 202, headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Source admission failed.' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
