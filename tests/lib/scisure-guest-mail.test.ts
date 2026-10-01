import { describe, expect, it } from 'vitest'
import {
  createGuestMailPayloadCipher,
  createGuestMailTransport,
  guestMagicLink,
  configuredGuestMailBaseUrl,
} from '@/lib/integrations/scisure/mail'

describe('durable guest admission mail transport', () => {
  const key = Buffer.alloc(32, 7).toString('base64')

  it('encrypts the complete mailbox payload at rest and rejects wrong-sized key material', () => {
    const cipher = createGuestMailPayloadCipher(key)
    const encrypted = cipher.encrypt({ address: 'chemist@example.test', fragmentToken: 'raw-secret', purpose: 'admission', expiresAt: '2026-10-01T12:15:00.000Z' })
    expect(encrypted).not.toContain('chemist@example.test')
    expect(encrypted).not.toContain('raw-secret')
    expect(cipher.decrypt(encrypted)).toEqual({ address: 'chemist@example.test', fragmentToken: 'raw-secret', purpose: 'admission', expiresAt: '2026-10-01T12:15:00.000Z' })
    expect(() => createGuestMailPayloadCipher(Buffer.alloc(31).toString('base64'))).toThrow(/32 bytes/i)
  })

  it('persists an encrypted admission message centrally without token-bearing idempotency metadata', async () => {
    const queued: Array<Record<string, unknown>> = []
    const transport = createGuestMailTransport({
      cipher: createGuestMailPayloadCipher(key),
      queue: async (input) => { queued.push(input); return { state: 'queued' as const } },
    })
    await expect(transport.queueMagicLink({ subjectId: 'subject-1', address: 'chemist@example.test', fragmentToken: 'raw-secret', purpose: 'admission', expiresAt: '2026-10-01T12:15:00.000Z' })).resolves.toEqual({ state: 'queued' })
    expect(queued).toHaveLength(1)
    expect(queued[0].encryptedPayload).not.toContain('raw-secret')
    expect(JSON.stringify(queued[0])).not.toContain('raw-secret')
    expect(queued[0]).toMatchObject({ subjectId: 'subject-1', purpose: 'admission', expiresAt: '2026-10-01T12:15:00.000Z' })
  })

  it('uses a server-approved verification route fragment, never a query token or client base URL', () => {
    const baseUrl = configuredGuestMailBaseUrl({
      GCAI_GUEST_MAIL_BASE_URL: 'https://staging.greenchemistry.ai',
      GCAI_GUEST_MAIL_ALLOWED_ORIGINS: 'https://greenchemistry.ai,https://staging.greenchemistry.ai',
    })
    expect(baseUrl).toBe('https://staging.greenchemistry.ai')
    expect(guestMagicLink({ baseUrl: baseUrl!, fragmentToken: 'raw-secret' })).toBe('https://staging.greenchemistry.ai/partners/scisure/guest/verify#token=raw-secret')
    expect(configuredGuestMailBaseUrl({ GCAI_GUEST_MAIL_BASE_URL: 'https://attacker.example', GCAI_GUEST_MAIL_ALLOWED_ORIGINS: 'https://greenchemistry.ai' })).toBeNull()
  })
})
