import { createHash, randomBytes } from 'node:crypto'

export type MailConfig = { endpoint: string; token: string; from: string }
export type OutboundMail = { to: string; subject: string; text: string; idempotencyKey: string }
export type MailResult = { kind: 'sent'; providerMessageId: string } | { kind: 'failed'; code: string } | { kind: 'uncertain' } | { kind: 'pending_configuration' }
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function configuredMail(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): MailConfig | null {
  const endpoint = env.GCAI_PARTNER_MAIL_ENDPOINT?.trim()
  const token = env.GCAI_PARTNER_MAIL_TOKEN?.trim()
  const from = env.GCAI_PARTNER_MAIL_FROM?.trim()
  const allowedOrigin = env.GCAI_PARTNER_MAIL_ALLOWED_ORIGIN?.trim()
  if (!endpoint || !token || !from || !allowedOrigin) return null
  try {
    const configured = new URL(endpoint)
    const approved = new URL(allowedOrigin)
    if (configured.protocol !== 'https:' || configured.origin !== approved.origin || configured.username || configured.password) return null
  } catch { return null }
  return { endpoint, token, from }
}

export async function dispatchMail(config: MailConfig | null, message: OutboundMail, fetcher: Fetcher = fetch): Promise<MailResult> {
  if (!config) return { kind: 'pending_configuration' }
  try {
    const response = await fetcher(config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}`, 'idempotency-key': message.idempotencyKey },
      body: JSON.stringify({ from: config.from, to: message.to, subject: message.subject, text: message.text }),
    })
    if (!response.ok) return { kind: 'failed', code: `http_${response.status}` }
    let body: unknown
    try { body = await response.json() } catch { return { kind: 'failed', code: 'missing_provider_receipt' } }
    const id = body && typeof body === 'object' && typeof (body as Record<string, unknown>).id === 'string' ? (body as Record<string, string>).id : null
    return id ? { kind: 'sent', providerMessageId: id } : { kind: 'failed', code: 'missing_provider_receipt' }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { kind: 'uncertain' }
    return { kind: 'failed', code: 'transport_error' }
  }
}

export function makeMailboxDelivery(input: { email: string; purpose: 'verification' | 'recovery'; token: string; baseUrl: string }): OutboundMail & { logSafe: string } {
  const url = new URL(input.purpose === 'verification' ? '/partners/scisure/mailbox/verify' : '/partners/scisure/results/recover', input.baseUrl)
  url.searchParams.set('token', input.token)
  const subject = input.purpose === 'verification' ? 'Verify your GreenChemistry.ai mailbox' : 'Your GreenChemistry.ai results link'
  const text = input.purpose === 'verification'
    ? `Verify this mailbox to receive GreenChemistry.ai delivery updates: ${url.toString()}\n\nThis link expires. It contains no protocol content.`
    : `Open your GreenChemistry.ai results link: ${url.toString()}\n\nThis link expires. It contains no protocol content.`
  return { to: input.email, subject, text, idempotencyKey: `mailbox:${input.purpose}:${input.token}`, logSafe: `${input.purpose} mailbox message prepared` }
}

export function createMailboxDeliveryRequest(input: { emailEventId: string; purpose: 'verification' | 'recovery'; baseUrl: string }) {
  const secret = randomBytes(32).toString('base64url')
  return {
    emailEventId: input.emailEventId,
    purpose: input.purpose === 'verification' ? 'guest_mailbox_verification' as const : 'result_recovery' as const,
    secret,
    tokenHash: createHash('sha256').update(secret).digest('hex'),
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  }
}

export function makeUnsubscribePreference(input: { emailEventId: string; baseUrl: string }) {
  const secret = randomBytes(32).toString('base64url')
  const url = new URL('/partners/scisure/email-preferences', input.baseUrl)
  url.searchParams.set('token', secret)
  return {
    confirmationUrl: url.toString(),
    request: { emailEventId: input.emailEventId, purpose: 'marketing' as const, secret, tokenHash: createHash('sha256').update(secret).digest('hex') },
  }
}

export function consensualFollowup(email: string, unsubscribeUrl: string): OutboundMail {
  return { to: email, subject: 'GreenChemistry.ai updates', text: `You opted in to updates from GreenChemistry.ai. Manage preferences or unsubscribe: ${unsubscribeUrl}`, idempotencyKey: `marketing:${unsubscribeUrl}` }
}
