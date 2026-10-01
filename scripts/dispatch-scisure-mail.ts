import { createAdminClient } from '@/lib/supabase/admin'
import { configuredGuestMailBaseUrl, configuredMail, createGuestMailPayloadCipher, dispatchMail, guestMagicLink } from '@/lib/integrations/scisure/mail'

const LEASE_SECONDS = 900

type Leased = { outbox_id: string; inquiry_id: string | null; scisure_email_event_id: string | null; guest_subject_id: string | null; purpose: 'inquiry_notification' | 'consensual_followup' | 'guest_mailbox_verification' | 'result_recovery' | 'admission' | 'recovery'; encrypted_payload: string | null; expires_at: string | null; lease_token: string }

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
  } else if (row.guest_subject_id && row.encrypted_payload && row.expires_at) {
    if (Date.parse(row.expires_at) <= Date.now()) {
      const { error: finalError } = await admin.rpc('gpc_finalize_partner_mail' as never, { p_outbox_id: row.outbox_id, p_lease_token: row.lease_token, p_state: 'failed', p_provider_message_id: null, p_error_code: 'guest_mail_expired' } as never)
      if (finalError) throw finalError
      console.log(JSON.stringify({ worker: 'scisure-mail', outboxId: row.outbox_id, status: 'expired' }))
      return
    }
    const key = process.env.SCISURE_GUEST_MAIL_OUTBOX_AES_256_GCM_KEY?.trim()
    const baseUrl = configuredGuestMailBaseUrl()
    if (!key || !baseUrl) {
      const { error: finalError } = await admin.rpc('gpc_finalize_partner_mail' as never, { p_outbox_id: row.outbox_id, p_lease_token: row.lease_token, p_state: 'pending_configuration', p_provider_message_id: null, p_error_code: 'guest_mail_configuration_missing' } as never)
      if (finalError) throw finalError
      return
    }
    const payload = createGuestMailPayloadCipher(key).decrypt(row.encrypted_payload)
    if (payload.expiresAt !== row.expires_at || Date.parse(payload.expiresAt) <= Date.now()) throw new Error('Guest mail payload expiry mismatch.')
    to = payload.address
    subject = payload.purpose === 'admission' ? 'Verify your GreenChemistry.ai guest access' : 'Recover your GreenChemistry.ai guest access'
    text = `${payload.purpose === 'admission' ? 'Verify your guest access' : 'Recover your guest access'}: ${guestMagicLink({ baseUrl, fragmentToken: payload.fragmentToken })}\n\nThis link expires and contains no protocol content.`
  }
  const result = !process.env.GCAI_PARTNER_MAIL_DISPATCH_ENABLED || !to
    ? { kind: 'pending_configuration' as const }
    : await dispatchMail(config, { to, subject, text, idempotencyKey: `outbox:${row.outbox_id}` })
  const state = result.kind === 'accepted' ? 'accepted' : result.kind
  const { error: finalError } = await admin.rpc('gpc_finalize_partner_mail' as never, {
    p_outbox_id: row.outbox_id, p_lease_token: row.lease_token, p_state: state,
    p_provider_message_id: result.kind === 'accepted' ? result.providerMessageId : null,
    p_error_code: result.kind === 'failed' ? result.code : null,
  } as never)
  if (finalError) throw finalError
  if (row.scisure_email_event_id && result.kind === 'accepted') {
    const { error: eventError } = await admin.from('gpc_scisure_email_events').update({ state: 'accepted' }).eq('id', row.scisure_email_event_id)
    if (eventError) throw eventError
  }
  console.log(JSON.stringify({ worker: 'scisure-mail', outboxId: row.outbox_id, status: result.kind }))
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Mail dispatch failed.'); process.exitCode = 1 })
