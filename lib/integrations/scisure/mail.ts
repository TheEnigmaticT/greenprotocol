import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import nodemailer from 'nodemailer'
import type { GuestMailTransport } from './guest'

const PRIVATE_MAIL_SMTP_HOST = 'mail.privateemail.com'
const PRIVATE_MAIL_SENDER = 'trevor@greenchemistry.ai'
const SMTP_TIMEOUT_MS = 10_000

export type HttpMailConfig = { kind: 'httpapi'; endpoint: string; token: string; from: typeof PRIVATE_MAIL_SENDER }
export type SmtpMailConfig = { kind: 'smtp'; host: typeof PRIVATE_MAIL_SMTP_HOST; port: 465 | 587; secure: boolean; requireTLS: boolean; user: typeof PRIVATE_MAIL_SENDER; password: string; from: typeof PRIVATE_MAIL_SENDER }
export type MailConfig = HttpMailConfig | SmtpMailConfig
export type OutboundMail = { to: string; subject: string; text: string; idempotencyKey: string }
export type MailResult = { kind: 'accepted'; providerMessageId: string } | { kind: 'failed'; code: string } | { kind: 'uncertain' } | { kind: 'pending_configuration' }
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export type MailTransport = { sendMail(message: { from: string; to: string; subject: string; text: string; headers: Record<string, string> }): Promise<{ messageId?: unknown; accepted?: unknown }> }
type DispatchDependencies = { createSmtpTransport?: (config: SmtpMailConfig) => MailTransport }
type GuestMailPayload = { address: string; fragmentToken: string; purpose: 'admission' | 'recovery'; expiresAt: string }
type GuestMailQueue = (input: { subjectId: string; purpose: 'admission' | 'recovery'; encryptedPayload: string; expiresAt: string }) => Promise<{ state: 'queued' | 'pending_configuration' }>
const FETCH_TIMEOUT_MS = 10_000

export function configuredMail(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): MailConfig | null {
  const transport = env.GCAI_PARTNER_MAIL_TRANSPORT?.trim()
  const from = env.GCAI_PARTNER_MAIL_FROM?.trim()
  if (from !== PRIVATE_MAIL_SENDER) return null
  if (transport === 'smtp') {
    const password = env.GCAI_PARTNER_MAIL_SMTP_PASSWORD?.trim(), port = env.GCAI_PARTNER_MAIL_SMTP_PORT?.trim() || '465'
    if (!password || (port !== '465' && port !== '587')) return null
    return { kind: 'smtp', host: PRIVATE_MAIL_SMTP_HOST, port: Number(port) as 465 | 587, secure: port === '465', requireTLS: true, user: PRIVATE_MAIL_SENDER, password, from: PRIVATE_MAIL_SENDER }
  }
  if (transport !== 'httpapi') return null
  const endpoint = env.GCAI_PARTNER_MAIL_ENDPOINT?.trim(), token = env.GCAI_PARTNER_MAIL_TOKEN?.trim(), allowedOrigin = env.GCAI_PARTNER_MAIL_ALLOWED_ORIGIN?.trim()
  if (!endpoint || !token || !allowedOrigin) return null
  try { const configured = new URL(endpoint), approved = new URL(allowedOrigin); if (configured.protocol !== 'https:' || configured.origin !== approved.origin || configured.username || configured.password) return null } catch { return null }
  return { kind: 'httpapi', endpoint, token, from: PRIVATE_MAIL_SENDER }
}

export function configuredGuestMailBaseUrl(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): string | null {
  const base = env.GCAI_GUEST_MAIL_BASE_URL?.trim(), allowed = env.GCAI_GUEST_MAIL_ALLOWED_ORIGINS?.split(',').map((v) => v.trim()).filter(Boolean) || []
  if (!base || !allowed.length) return null
  try { const url = new URL(base); return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && allowed.includes(url.origin) ? url.origin : null } catch { return null }
}

export function createGuestMailPayloadCipher(encodedKey: string) {
  let key: Buffer
  try { key = Buffer.from(encodedKey.trim(), 'base64') } catch { throw new Error('SCISURE_GUEST_MAIL_OUTBOX_AES_256_GCM_KEY must decode to exactly 32 bytes.') }
  if (key.length !== 32 || key.toString('base64') !== encodedKey.trim()) throw new Error('SCISURE_GUEST_MAIL_OUTBOX_AES_256_GCM_KEY must decode to exactly 32 bytes.')
  return {
    encrypt(payload: GuestMailPayload) {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce), ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]), tag = cipher.getAuthTag()
      return `v1.${nonce.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`
    },
    decrypt(envelope: string): GuestMailPayload {
      const [version, nonceText, tagText, ciphertextText, extra] = envelope.split('.')
      if (version !== 'v1' || !nonceText || !tagText || !ciphertextText || extra) throw new Error('Invalid encrypted guest mail payload.')
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceText, 'base64url')); decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
        const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8')) as GuestMailPayload
        if (!value || typeof value.address !== 'string' || typeof value.fragmentToken !== 'string' || (value.purpose !== 'admission' && value.purpose !== 'recovery') || typeof value.expiresAt !== 'string') throw new Error('bad payload')
        return value
      } catch { throw new Error('Invalid encrypted guest mail payload.') }
    },
  }
}

export function guestMagicLink(input: { baseUrl: string; fragmentToken: string }) { const url = new URL('/partners/scisure/guest/verify', input.baseUrl); url.hash = `token=${encodeURIComponent(input.fragmentToken)}`; return url.toString() }
export function createGuestMailTransport(input: { cipher: ReturnType<typeof createGuestMailPayloadCipher>; queue: GuestMailQueue }): GuestMailTransport { return { async queueMagicLink(message) { return input.queue({ subjectId: message.subjectId, purpose: message.purpose, encryptedPayload: input.cipher.encrypt({ address: message.address, fragmentToken: message.fragmentToken, purpose: message.purpose, expiresAt: message.expiresAt }), expiresAt: message.expiresAt }) } } }

export async function dispatchMail(config: MailConfig | null, message: OutboundMail, fetcher: Fetcher = fetch, dependencies: DispatchDependencies = {}): Promise<MailResult> {
  if (!config) return { kind: 'pending_configuration' }
  if (config.kind === 'smtp') {
    try {
      const transport = dependencies.createSmtpTransport?.(config) || nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, requireTLS: config.requireTLS, auth: { user: config.user, pass: config.password }, connectionTimeout: SMTP_TIMEOUT_MS, greetingTimeout: SMTP_TIMEOUT_MS, socketTimeout: SMTP_TIMEOUT_MS })
      const receipt = await transport.sendMail({ from: config.from, to: message.to, subject: message.subject, text: message.text, headers: { 'X-GCAI-Outbox-Key': createHash('sha256').update(message.idempotencyKey).digest('hex') } })
      return typeof receipt.messageId === 'string' && receipt.messageId.length > 0 ? { kind: 'accepted', providerMessageId: receipt.messageId } : { kind: 'uncertain' }
    } catch { return { kind: 'uncertain' } }
  }
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetcher(config.endpoint, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}`, 'idempotency-key': createHash('sha256').update(message.idempotencyKey).digest('hex') }, body: JSON.stringify({ from: config.from, to: message.to, subject: message.subject, text: message.text }) })
    if (!response.ok) return response.status >= 500 ? { kind: 'uncertain' } : { kind: 'failed', code: `http_${response.status}` }
    let body: unknown; try { body = await response.json() } catch { return { kind: 'uncertain' } }
    const id = body && typeof body === 'object' && typeof (body as Record<string, unknown>).id === 'string' ? (body as Record<string, string>).id : null
    return id ? { kind: 'accepted', providerMessageId: id } : { kind: 'uncertain' }
  } catch { return { kind: 'uncertain' } } finally { clearTimeout(timeout) }
}

export function makeMailboxDelivery(input: { email: string; purpose: 'verification' | 'recovery'; token: string; baseUrl: string }): OutboundMail & { logSafe: string } {
  const url = new URL(input.purpose === 'verification' ? '/partners/scisure/mailbox/verify' : '/partners/scisure/results/recover', input.baseUrl); url.searchParams.set('token', input.token)
  const subject = input.purpose === 'verification' ? 'Verify your GreenChemistry.ai mailbox' : 'Your GreenChemistry.ai results link'
  const text = input.purpose === 'verification' ? `Verify this mailbox to receive GreenChemistry.ai delivery updates: ${url.toString()}\n\nThis link expires. It contains no protocol content.` : `Open your GreenChemistry.ai results link: ${url.toString()}\n\nThis link expires. It contains no protocol content.`
  return { to: input.email, subject, text, idempotencyKey: `mailbox:${input.purpose}:${input.token}`, logSafe: `${input.purpose} mailbox message prepared` }
}
export function createMailboxDeliveryRequest(input: { emailEventId: string; purpose: 'verification' | 'recovery'; baseUrl: string }) { const secret = randomBytes(32).toString('base64url'); return { emailEventId: input.emailEventId, purpose: input.purpose === 'verification' ? 'guest_mailbox_verification' as const : 'result_recovery' as const, secret, tokenHash: createHash('sha256').update(secret).digest('hex'), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() } }
export function makeUnsubscribePreference(input: { emailEventId: string; baseUrl: string }) { const secret = randomBytes(32).toString('base64url'), url = new URL('/partners/scisure/email-preferences', input.baseUrl); url.searchParams.set('token', secret); return { confirmationUrl: url.toString(), request: { emailEventId: input.emailEventId, purpose: 'marketing' as const, secret, tokenHash: createHash('sha256').update(secret).digest('hex') } } }
export function consensualFollowup(email: string, unsubscribeUrl: string): OutboundMail { return { to: email, subject: 'GreenChemistry.ai updates', text: `You opted in to updates from GreenChemistry.ai. Manage preferences or unsubscribe: ${unsubscribeUrl}`, idempotencyKey: `marketing:${unsubscribeUrl}` } }