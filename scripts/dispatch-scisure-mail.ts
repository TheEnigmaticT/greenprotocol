import { createAdminClient } from '@/lib/supabase/admin'
import { configuredMail, dispatchMail } from '@/lib/integrations/scisure/mail'

const LEASE_SECONDS = 900

type Leased = { outbox_id: string; inquiry_id: string | null; scisure_email_event_id: string | null; purpose: 'inquiry_notification' | 'consensual_followup' | 'guest_mailbox_verification' | 'result_recovery'; lease_token: string }

async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Mail dispatch requires the service-role client.')
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('gpc_lease_partner_mail' as never, { p_lease_seconds: LEASE_SECONDS } as never)
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : null) as Leased | null
  if (!row) { console.log(JSON.stringify({ worker: 'scisure-mail', status: 'idle' })); return }
  const config = configuredMail()
  let to: string | undefined
  let subject = ''
  let text = ''
  if (row.purpose === 'inquiry_notification') {
    to = process.env.GCAI_PARTNER_INQUIRY_DESTINATION?.trim()
    subject = 'New SciSure partnership inquiry'
    text = 'A new SciSure partnership inquiry is available in the GreenChemistry.ai partner inbox.'
  } else if (row.scisure_email_event_id) {
    const { data: event, error: eventError } = await admin.from('gpc_scisure_email_events').select('address,purpose').eq('id', row.scisure_email_event_id).single()
    if (eventError || !event) throw new Error('Mail recipient record is unavailable.')
    to = event.address
    subject = event.purpose === 'marketing' ? 'GreenChemistry.ai updates' : 'GreenChemistry.ai delivery update'
    text = event.purpose === 'marketing' ? 'You opted in to GreenChemistry.ai updates. Manage preferences through your secure link.' : 'Your GreenChemistry.ai delivery update is available through your secure link.'
  }
  const result = !process.env.GCAI_PARTNER_MAIL_DISPATCH_ENABLED || !to
    ? { kind: 'pending_configuration' as const }
    : await dispatchMail(config, { to, subject, text, idempotencyKey: `outbox:${row.outbox_id}` })
  const state = result.kind === 'sent' ? 'sent' : result.kind
  const { error: finalError } = await admin.rpc('gpc_finalize_partner_mail' as never, {
    p_outbox_id: row.outbox_id, p_lease_token: row.lease_token, p_state: state,
    p_provider_message_id: result.kind === 'sent' ? result.providerMessageId : null,
    p_error_code: result.kind === 'failed' ? result.code : null,
  } as never)
  if (finalError) throw finalError
  if (row.scisure_email_event_id && result.kind === 'sent') {
    const { error: eventError } = await admin.from('gpc_scisure_email_events').update({ state: 'sent' }).eq('id', row.scisure_email_event_id)
    if (eventError) throw eventError
  }
  console.log(JSON.stringify({ worker: 'scisure-mail', outboxId: row.outbox_id, status: result.kind }))
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Mail dispatch failed.'); process.exitCode = 1 })
