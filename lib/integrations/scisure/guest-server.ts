import { createAdminClient } from '@/lib/supabase/admin'
import {
  createGuestAdmissionService,
  type GuestAdmissionStore,
  type GuestCaptchaVerifier,
  type GuestMailTransport,
} from './guest'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const DAYS_90 = 90 * 86_400_000

export function createTurnstileVerifier(fetcher: typeof fetch = fetch): GuestCaptchaVerifier {
  return {
    async verify(token) {
      const secret = process.env.TURNSTILE_SECRET_KEY
      if (!secret || !token) return { ok: false }
      const body = new URLSearchParams({ secret, response: token })
      const response = await fetcher(TURNSTILE_VERIFY_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, cache: 'no-store' })
      if (!response.ok) return { ok: false }
      const payload = await response.json() as { success?: unknown; hostname?: unknown; action?: unknown }
      const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME
      const expectedAction = process.env.TURNSTILE_EXPECTED_ACTION || 'scisure_guest_admission'
      return { ok: payload.success === true && typeof payload.hostname === 'string' && payload.hostname === expectedHostname && payload.action === expectedAction }
    },
  }
}

function configuredStore(): GuestAdmissionStore {
  const admin = createAdminClient() as any
  return {
    async subjectForEmail(emailHash) {
      const { data, error } = await admin.from('gpc_scisure_guest_subjects').upsert({ subject_hash: emailHash, expires_at: new Date(Date.now() + DAYS_90).toISOString() }, { onConflict: 'subject_hash' }).select('id, subject_hash').single()
      if (error || !data) throw new Error('Guest admission storage is unavailable.')
      return { id: data.id, emailHash: data.subject_hash, used: 0 }
    },
    async createChallenge(challenge) {
      const { error } = await admin.from('gpc_scisure_guest_email_challenges').insert({ token_hash: challenge.tokenHash, subject_id: challenge.subjectId, expires_at: new Date(challenge.expiresAt).toISOString() })
      if (error) throw new Error('Could not create email proof.')
    },
    async consumeChallenge(tokenHash, now) {
      const { data, error } = await admin.rpc('gpc_consume_scisure_guest_email_challenge', { p_token_hash: tokenHash, p_now: new Date(now).toISOString() })
      const row = Array.isArray(data) ? data[0] : null
      if (error || !row) return null
      return { tokenHash, subjectId: String(row.subject_id), expiresAt: Date.parse(String(row.expires_at)), consumedAt: now }
    },
    async putAdmission(admission) {
      const { error } = await admin.from('gpc_scisure_guest_admissions').insert({ token_hash: admission.tokenHash, subject_id: admission.subjectId, expires_at: new Date(admission.expiresAt).toISOString() })
      if (error) throw new Error('Could not create guest admission.')
    },
    async admissionForToken(tokenHash, now) {
      const { data, error } = await admin.from('gpc_scisure_guest_admissions').select('subject_id, expires_at, revoked_at').eq('token_hash', tokenHash).maybeSingle()
      if (error || !data || data.revoked_at || Date.parse(data.expires_at) <= now) return null
      return { tokenHash, subjectId: String(data.subject_id), expiresAt: Date.parse(data.expires_at) }
    },
    async reserve(subjectId, idempotencyKey, allowance) {
      const { data, error } = await admin.rpc('gpc_reserve_scisure_guest_subject_trial', { p_subject_id: subjectId, p_idempotency_key: idempotencyKey, p_limit: allowance })
      const row = Array.isArray(data) ? data[0] : null
      if (error || !row) return 'exhausted'
      return row.state === 'replayed' ? 'replayed' : row.state === 'reserved' ? 'reserved' : 'exhausted'
    },
    async remaining(subjectId, allowance) {
      const { data } = await admin.rpc('gpc_scisure_guest_subject_remaining', { p_subject_id: subjectId, p_limit: allowance })
      return typeof data === 'number' ? data : 0
    },
    async recordPendingEmail(subjectId, purpose) {
      await admin.from('gpc_scisure_guest_email_events').upsert({ subject_id: subjectId, purpose, state: 'pending_configuration' }, { onConflict: 'subject_id,purpose' })
    },
    async claim(subjectId, userId, resultId) {
      const { error } = await admin.rpc('gpc_claim_scisure_guest_result', { p_subject_id: subjectId, p_user_id: userId, p_job_id: resultId })
      if (error) throw new Error('Guest result claim is unavailable.')
    },
  }
}

/** Mail is intentionally absent until the service-backed outbox transport is injected. */
export function configuredGuestAdmissionService(mail?: GuestMailTransport) {
  const subjectKey = process.env.SCISURE_GUEST_SUBJECT_HASH_KEY || ''
  const tokenKey = process.env.SCISURE_GUEST_ADMISSION_HMAC_KEY || ''
  const allowance = Number.parseInt(process.env.SCISURE_GUEST_TRIAL_LIMIT || '1', 10)
  return createGuestAdmissionService({ store: configuredStore(), captcha: createTurnstileVerifier(), mail, subjectKey, tokenKey, allowance })
}
