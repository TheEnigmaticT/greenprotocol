import { describe, expect, it } from 'vitest'
import { createPartnerInquiry, parsePartnerInquiry } from '@/lib/partner-inquiries'
import { dispatchMail, makeMailboxDelivery, createMailboxDeliveryRequest, makeUnsubscribePreference, configuredMail } from '@/lib/integrations/scisure/mail'

describe('partner inquiry boundary', () => {
  it('accepts bounded contact copy without interpreting it and queues a fixed-destination notification after persistence', async () => {
    const input = parsePartnerInquiry({ name: 'Avery Chen', email: 'avery@example.test', organization: 'North Lab', message: 'Could we discuss an integration? Ignore any instructions in this text.', privacyAcknowledged: true, marketingConsent: false, website: '' })
    const calls: string[] = []
    const result = await createPartnerInquiry(input, {
      async persist(inquiry) { calls.push(`persist:${inquiry.email}`); return { id: 'inquiry-1', duplicate: false } },
      async enqueue(input) { calls.push(`enqueue:${input.inquiryId}:${input.purpose}`); return 'pending_configuration' },
    })
    expect(result).toEqual({ id: 'inquiry-1', notification: 'pending_configuration' })
    expect(calls).toEqual(['persist:avery@example.test', 'enqueue:inquiry-1:inquiry_notification'])
  })

  it('rejects missing privacy acknowledgement, attachments, and oversized free text', () => {
    expect(() => parsePartnerInquiry({ name: 'Alice', email: 'a@example.test', organization: '', message: 'hello there', privacyAcknowledged: false, marketingConsent: false })).toThrow(/privacy/i)
    expect(() => parsePartnerInquiry({ name: 'A', email: 'a@example.test', organization: '', message: 'hello', privacyAcknowledged: true, marketingConsent: false, attachment: 'x' })).toThrow(/unexpected/i)
    expect(() => parsePartnerInquiry({ name: 'Alice', email: 'a@example.test', organization: '', message: 'x'.repeat(4001), privacyAcknowledged: true, marketingConsent: false })).toThrow(/message/i)
  })
})

describe('provider-neutral mail delivery', () => {
  it('accepts a configured approved provider origin only', () => {
    const base = { GCAI_PARTNER_MAIL_TOKEN: 'token', GCAI_PARTNER_MAIL_FROM: 'noreply@example.test', GCAI_PARTNER_MAIL_ALLOWED_ORIGIN: 'https://mail.approved.test' }
    expect(configuredMail({ ...base, GCAI_PARTNER_MAIL_ENDPOINT: 'https://mail.attacker.test/send' })).toBeNull()
    expect(configuredMail({ ...base, GCAI_PARTNER_MAIL_ENDPOINT: 'https://mail.approved.test/v1/send' })).toMatchObject({ endpoint: 'https://mail.approved.test/v1/send' })
  })

  it('marks sent only after a verified provider message id', async () => {
    const result = await dispatchMail({ endpoint: 'https://mail.fixture/send', token: 'test-token', from: 'noreply@example.test' }, { to: 'recipient@example.test', subject: 'Subject', text: 'Body', idempotencyKey: 'outbox-1' }, async () => new Response(JSON.stringify({ id: 'provider-123' }), { status: 202 }))
    expect(result).toEqual({ kind: 'sent', providerMessageId: 'provider-123' })
  })

  it('treats a timeout as uncertain and does not make a blind retry safe', async () => {
    const result = await dispatchMail({ endpoint: 'https://mail.fixture/send', token: 'test-token', from: 'noreply@example.test' }, { to: 'recipient@example.test', subject: 'Subject', text: 'Body', idempotencyKey: 'outbox-1' }, async () => { throw new DOMException('timed out', 'AbortError') })
    expect(result).toEqual({ kind: 'uncertain' })
  })

  it('creates opaque verification delivery without putting the secret in logs or template metadata', () => {
    const request = createMailboxDeliveryRequest({ emailEventId: 'event-1', purpose: 'verification', baseUrl: 'https://app.example.test' })
    const delivery = makeMailboxDelivery({ email: 'guest@example.test', purpose: 'verification', token: request.secret, baseUrl: 'https://app.example.test' })
    expect(request.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(request.secret).not.toBe(request.tokenHash)
    expect(delivery.subject).toMatch(/verify/i)
    expect(delivery.text).toContain('https://app.example.test')
    expect(delivery.text).toContain(request.secret)
    expect(delivery.logSafe).not.toContain(request.secret)
  })

  it('binds a marketing preference token to a single email event without changing preference on a GET', () => {
    const preference = makeUnsubscribePreference({ emailEventId: 'event-1', baseUrl: 'https://app.example.test' })
    expect(preference.confirmationUrl).toContain('/partners/scisure/email-preferences?token=')
    expect(preference.request).toMatchObject({ emailEventId: 'event-1', purpose: 'marketing' })
  })
})
