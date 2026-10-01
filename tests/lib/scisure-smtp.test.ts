import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SMTPServer } from 'smtp-server'
import { configuredMail, dispatchMail, type MailTransport } from '@/lib/integrations/scisure/mail'

const tls = {
  key: readFileSync(join(process.cwd(), 'tests/fixtures/smtp/localhost-key.pem')),
  cert: readFileSync(join(process.cwd(), 'tests/fixtures/smtp/localhost-cert.pem')),
}

describe('PrivateMail SMTP transport', () => {
  const received: Array<{ from: string; to: string[]; data: string }> = []
  const server = new SMTPServer({
    secure: true,
    key: tls.key,
    cert: tls.cert,
    authOptional: false,
    onAuth(auth, _session, callback) {
      callback(auth.username === 'trevor@greenchemistry.ai' && auth.password === 'fixture-password' ? null : new Error('invalid credentials'), { user: auth.username })
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => { received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '', to: session.envelope.rcptTo.map((entry) => entry.address), data: Buffer.concat(chunks).toString('utf8') }); callback() })
    },
  })
  let port = 0

  beforeAll(async () => { await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => { port = (server.server.address() as { port: number }).port; resolve() })) })
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })

  it('only selects SMTP when explicitly enabled and accepts the fixed PrivateMail TLS configuration', () => {
    const env = {
      GCAI_PARTNER_MAIL_TRANSPORT: 'smtp',
      GCAI_PARTNER_MAIL_SMTP_PORT: '465',
      GCAI_PARTNER_MAIL_SMTP_PASSWORD: 'fixture-password',
      GCAI_PARTNER_MAIL_FROM: 'trevor@greenchemistry.ai',
    }
    expect(configuredMail(env)).toMatchObject({ kind: 'smtp', host: 'mail.privateemail.com', port: 465, secure: true, user: 'trevor@greenchemistry.ai', from: 'trevor@greenchemistry.ai' })
    expect(configuredMail({ ...env, GCAI_PARTNER_MAIL_TRANSPORT: 'SMTP' })).toBeNull()
    expect(configuredMail({ ...env, GCAI_PARTNER_MAIL_SMTP_PORT: '587' })).toMatchObject({ port: 587, secure: false, requireTLS: true })
    expect(configuredMail({ ...env, GCAI_PARTNER_MAIL_FROM: 'other@greenchemistry.ai' })).toBeNull()
  })

  it('uses authenticated TLS SMTP and records acceptance rather than inbox delivery', async () => {
    const config = configuredMail({
      GCAI_PARTNER_MAIL_TRANSPORT: 'smtp', GCAI_PARTNER_MAIL_SMTP_PORT: '465',
      GCAI_PARTNER_MAIL_SMTP_PASSWORD: 'fixture-password', GCAI_PARTNER_MAIL_FROM: 'trevor@greenchemistry.ai',
    })!
    if (config.kind !== 'smtp') throw new Error('expected SMTP configuration')
    const result = await dispatchMail(config, { to: 'recipient@example.test', subject: 'Subject', text: 'Body', idempotencyKey: 'outbox-1' }, undefined, {
      createSmtpTransport: () => ({
        async sendMail(message) {
          const nodemailer = await import('nodemailer')
          return nodemailer.createTransport({ host: 'localhost', port, secure: true, auth: { user: config.user, pass: config.password }, tls: { ca: tls.cert, servername: 'localhost' } }).sendMail(message)
        },
      }),
    })
    expect(result).toMatchObject({ kind: 'accepted' })
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ from: 'trevor@greenchemistry.ai', to: ['recipient@example.test'] })
    expect(received[0].data).toContain('Subject')
  })

  it('maps a transport failure after SMTP submission begins to uncertain and never retries it', async () => {
    let sends = 0
    const transport: MailTransport = { async sendMail() { sends += 1; throw Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' }) } }
    const config = configuredMail({ GCAI_PARTNER_MAIL_TRANSPORT: 'smtp', GCAI_PARTNER_MAIL_SMTP_PORT: '465', GCAI_PARTNER_MAIL_SMTP_PASSWORD: 'fixture-password', GCAI_PARTNER_MAIL_FROM: 'trevor@greenchemistry.ai' })!
    if (config.kind !== 'smtp') throw new Error('expected SMTP configuration')
    await expect(dispatchMail(config, { to: 'recipient@example.test', subject: 'Subject', text: 'Body', idempotencyKey: 'outbox-2' }, undefined, { createSmtpTransport: () => transport })).resolves.toEqual({ kind: 'uncertain' })
    expect(sends).toBe(1)
  })
})