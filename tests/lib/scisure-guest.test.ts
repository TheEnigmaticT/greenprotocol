import { describe, expect, it } from 'vitest'
import {
  createGuestAdmissionService,
  createInMemoryGuestAdmissionStore,
  type GuestCaptchaVerifier,
  type GuestMailTransport,
} from '@/lib/integrations/scisure/guest'

const captcha: GuestCaptchaVerifier = {
  async verify(token) { return { ok: token === 'captcha-ok' } },
}

function transport(): GuestMailTransport & { messages: Array<{ address: string; fragmentToken: string; purpose: 'admission' | 'recovery' }> } {
  const messages: Array<{ address: string; fragmentToken: string; purpose: 'admission' | 'recovery' }> = []
  return { messages, async queueMagicLink(input) { messages.push({ address: input.address, fragmentToken: input.fragmentToken, purpose: input.purpose }); return { state: 'queued' } } }
}

function service(overrides: { now?: () => Date; mail?: GuestMailTransport; allowance?: number } = {}) {
  return createGuestAdmissionService({
    store: createInMemoryGuestAdmissionStore(),
    captcha,
    mail: overrides.mail,
    subjectKey: 's'.repeat(48),
    tokenKey: 't'.repeat(48),
    now: overrides.now || (() => new Date('2026-10-01T12:00:00.000Z')),
    allowance: overrides.allowance ?? 1,
  })
}

describe('SciSure guest admission', () => {
  it('fails closed when captcha verification rejects the request', async () => {
    const result = await service().requestEmailChallenge({ address: 'chemist@example.test', captchaToken: 'invalid', ipSignal: 'shared-lab' })
    expect(result).toEqual({ state: 'rejected' })
  })

  it('requires one-time mailbox proof before issuing a scoped admission token', async () => {
    const mail = transport()
    const issuer = service({ mail })
    expect(await issuer.requestEmailChallenge({ address: 'chemist@example.test', captchaToken: 'captcha-ok', ipSignal: 'shared-lab' })).toEqual({ state: 'queued' })
    expect(mail.messages).toHaveLength(1)

    const admission = await issuer.verifyEmailChallenge({ fragmentToken: mail.messages[0].fragmentToken, browserBinding: 'browser-a' })
    expect(admission).toMatchObject({ state: 'issued', remaining: 1, subjectId: expect.any(String), admissionToken: expect.stringMatching(/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/) })
    expect(await issuer.verifyEmailChallenge({ fragmentToken: mail.messages[0].fragmentToken, browserBinding: 'browser-a' })).toEqual({ state: 'rejected' })
  })

  it('queues pending configuration rather than pretending email was delivered', async () => {
    expect(await service().requestEmailChallenge({ address: 'chemist@example.test', captchaToken: 'captcha-ok' })).toEqual({ state: 'pending_configuration' })
  })

  it('keeps admission and recovery on one ledger without optional marketing', async () => {
    const mail = transport(); const issuer = service({ mail, allowance: 1 })
    await issuer.requestEmailChallenge({ address: 'chemist@example.test', captchaToken: 'captcha-ok' })
    const first = await issuer.verifyEmailChallenge({ fragmentToken: mail.messages[0].fragmentToken, browserBinding: 'browser-a' })
    if (first.state !== 'issued') throw new Error('expected admission')
    expect(await Promise.all([issuer.reserveTrial({ admissionToken: first.admissionToken, idempotencyKey: 'job-a' }), issuer.reserveTrial({ admissionToken: first.admissionToken, idempotencyKey: 'job-b' })])).toEqual(expect.arrayContaining([{ state: 'reserved', replayed: false }, { state: 'exhausted' }]))

    await issuer.requestRecovery({ address: 'chemist@example.test', captchaToken: 'captcha-ok' })
    expect(mail.messages[1].purpose).toBe('recovery')
    const recovered = await issuer.verifyEmailChallenge({ fragmentToken: mail.messages[1].fragmentToken, browserBinding: 'browser-b' })
    expect(recovered).toMatchObject({ state: 'issued', subjectId: first.subjectId, remaining: 0 })
    if (recovered.state !== 'issued') throw new Error('expected recovery')
    expect(await issuer.reserveTrial({ admissionToken: recovered.admissionToken, idempotencyKey: 'job-c' })).toEqual({ state: 'exhausted' })
  })

  it('binds the short-lived admission to the browser that completed mailbox proof', async () => {
    const mail = transport(); const issuer = service({ mail })
    await issuer.requestEmailChallenge({ address: 'chemist@example.test', captchaToken: 'captcha-ok' })
    const admission = await issuer.verifyEmailChallenge({ fragmentToken: mail.messages[0].fragmentToken, browserBinding: 'browser-a' })
    if (admission.state !== 'issued') throw new Error('expected admission')
    expect(await issuer.subjectForAdmission(admission.admissionToken, 'browser-a')).toBe(admission.subjectId)
    expect(await issuer.subjectForAdmission(admission.admissionToken, 'browser-b')).toBeNull()
  })

  it('rejects an expired email proof and account claim without its bound browser proof', async () => {
    let time = new Date('2026-10-01T12:00:00.000Z')
    const mail = transport(); const issuer = service({ mail, now: () => time })
    await issuer.requestEmailChallenge({ address: 'chemist@example.test', captchaToken: 'captcha-ok' })
    time = new Date('2026-10-01T12:16:00.000Z')
    expect(await issuer.verifyEmailChallenge({ fragmentToken: mail.messages[0].fragmentToken, browserBinding: 'browser-a' })).toEqual({ state: 'expired' })

    time = new Date('2026-10-01T12:00:00.000Z')
    await issuer.requestEmailChallenge({ address: 'chemist@example.test', captchaToken: 'captcha-ok' })
    const admission = await issuer.verifyEmailChallenge({ fragmentToken: mail.messages[1].fragmentToken, browserBinding: 'browser-a' })
    if (admission.state !== 'issued') throw new Error('expected admission')
    expect(await issuer.claimToAccount({ admissionToken: admission.admissionToken, authenticatedUserId: null, guestOwnedResultId: 'job-1' })).toEqual({ state: 'rejected' })
    expect(await issuer.claimToAccount({ admissionToken: 'stolen.token', authenticatedUserId: '11111111-1111-4111-8111-111111111111', guestOwnedResultId: 'job-1' })).toEqual({ state: 'rejected' })
    expect(await issuer.claimToAccount({ admissionToken: admission.admissionToken, authenticatedUserId: '11111111-1111-4111-8111-111111111111', guestOwnedResultId: 'job-1' })).toEqual({ state: 'rejected' })
    expect(await issuer.claimToAccount({ admissionToken: admission.admissionToken, browserBinding: 'browser-b', authenticatedUserId: '11111111-1111-4111-8111-111111111111', guestOwnedResultId: 'job-1' })).toEqual({ state: 'rejected' })
    expect(await issuer.claimToAccount({ admissionToken: admission.admissionToken, browserBinding: 'browser-a', authenticatedUserId: '11111111-1111-4111-8111-111111111111', guestOwnedResultId: 'job-1' })).toEqual({ state: 'claimed', userId: '11111111-1111-4111-8111-111111111111', resultId: 'job-1' })
  })
})
