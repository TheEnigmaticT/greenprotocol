import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const EMAIL_PROOF_MINUTES = 15
const ADMISSION_HOURS = 1
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,160}$/

type Challenge = { tokenHash: string; subjectId: string; expiresAt: number; consumedAt: number | null }
type Subject = { id: string; emailHash: string; used: number }
type Admission = { tokenHash: string; subjectId: string; expiresAt: number }

export type GuestCaptchaVerifier = { verify(token: string, context?: { ipSignal?: string }): Promise<{ ok: boolean }> }
export type GuestMailTransport = {
  queueMagicLink(input: { subjectId: string; address: string; fragmentToken: string; purpose: 'admission' | 'recovery'; expiresAt: string }): Promise<{ state: 'queued' | 'pending_configuration' }>
}
export type GuestAdmissionStore = {
  subjectForEmail(emailHash: string): Promise<Subject>
  createChallenge(challenge: Challenge): Promise<void>
  consumeChallenge(tokenHash: string, now: number): Promise<Challenge | null>
  putAdmission(admission: Admission): Promise<void>
  admissionForToken(tokenHash: string, now: number): Promise<Admission | null>
  reserve(subjectId: string, idempotencyKey: string, allowance: number): Promise<'reserved' | 'replayed' | 'exhausted'>
  remaining(subjectId: string, allowance: number): Promise<number>
  recordPendingEmail?(subjectId: string, purpose: 'admission' | 'recovery'): Promise<void>
  claim(subjectId: string, userId: string, resultId: string): Promise<void>
}

function hash(value: string) { return createHash('sha256').update(value).digest('hex') }
function keyedHash(key: string, value: string) { return createHmac('sha256', key).update(value).digest('hex') }
function id() { return randomBytes(18).toString('base64url') }
function normalizeEmail(value: string) {
  const address = value.trim().toLowerCase()
  if (!EMAIL.test(address) || address.length > 254) throw new Error('Invalid email address.')
  return address
}
function safeEqual(left: string, right: string) {
  return left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right))
}

export function createInMemoryGuestAdmissionStore(): GuestAdmissionStore {
  const subjects = new Map<string, Subject>()
  const challenges = new Map<string, Challenge>()
  const admissions = new Map<string, Admission>()
  const reservations = new Map<string, Set<string>>()
  const claims = new Map<string, { userId: string; resultId: string }>()
  return {
    async subjectForEmail(emailHash) {
      const current = subjects.get(emailHash)
      if (current) return current
      const subject = { id: id(), emailHash, used: 0 }
      subjects.set(emailHash, subject)
      return subject
    },
    async createChallenge(challenge) { challenges.set(challenge.tokenHash, challenge) },
    async consumeChallenge(tokenHash, now) {
      const challenge = challenges.get(tokenHash)
      if (!challenge || challenge.consumedAt) return null
      if (challenge.expiresAt <= now) return { ...challenge }
      challenge.consumedAt = now
      return { ...challenge }
    },
    async putAdmission(admission) { admissions.set(admission.tokenHash, admission) },
    async admissionForToken(tokenHash, now) {
      const admission = admissions.get(tokenHash)
      return admission && admission.expiresAt > now ? { ...admission } : null
    },
    async reserve(subjectId, idempotencyKey, allowance) {
      const subject = [...subjects.values()].find((candidate) => candidate.id === subjectId)
      if (!subject) return 'exhausted'
      const ids = reservations.get(subjectId) || new Set<string>()
      if (ids.has(idempotencyKey)) return 'replayed'
      if (subject.used >= allowance) return 'exhausted'
      ids.add(idempotencyKey); reservations.set(subjectId, ids); subject.used += 1
      return 'reserved'
    },
    async remaining(subjectId, allowance) {
      const subject = [...subjects.values()].find((candidate) => candidate.id === subjectId)
      return subject ? Math.max(0, allowance - subject.used) : 0
    },
    async claim(subjectId, userId, resultId) { claims.set(`${subjectId}:${resultId}`, { userId, resultId }) },
  }
}

export function createGuestAdmissionService(input: {
  store: GuestAdmissionStore
  captcha: GuestCaptchaVerifier
  mail?: GuestMailTransport
  subjectKey: string
  tokenKey: string
  allowance?: number
  now?: () => Date
}) {
  if (input.subjectKey.length < 32 || input.tokenKey.length < 32) throw new Error('Guest admission keys must be configured.')
  const now = input.now || (() => new Date())
  const allowance = input.allowance ?? 1
  if (!Number.isSafeInteger(allowance) || allowance < 1 || allowance > 1000) throw new Error('Invalid guest trial allowance.')
  const emailHash = (email: string) => keyedHash(input.subjectKey, normalizeEmail(email))
  const issue = async (address: string, captchaToken: string, purpose: 'admission' | 'recovery', ipSignal?: string) => {
    if (!captchaToken || captchaToken.length > 4096) return { state: 'rejected' as const }
    const result = await input.captcha.verify(captchaToken, { ipSignal })
    if (!result.ok) return { state: 'rejected' as const }
    const normalized = normalizeEmail(address)
    const subject = await input.store.subjectForEmail(emailHash(normalized))
    const secret = id()
    const expiresAt = now().getTime() + EMAIL_PROOF_MINUTES * 60_000
    await input.store.createChallenge({ tokenHash: hash(secret), subjectId: subject.id, expiresAt, consumedAt: null })
    if (!input.mail) { await input.store.recordPendingEmail?.(subject.id, purpose); return { state: 'pending_configuration' as const } }
    const delivery = await input.mail.queueMagicLink({ subjectId: subject.id, address: normalized, fragmentToken: secret, purpose, expiresAt: new Date(expiresAt).toISOString() })
    return { state: delivery.state }
  }
  const signAdmission = (subjectId: string, browserBinding: string) => {
    const claims = Buffer.from(JSON.stringify({ v: 1, typ: 'scisure-guest', sub: subjectId, bind: hash(browserBinding), challenge: id(), exp: Math.floor((now().getTime() + ADMISSION_HOURS * 3_600_000) / 1000), jti: id() })).toString('base64url')
    return `${claims}.${createHmac('sha256', input.tokenKey).update(claims).digest('hex')}`
  }
  const readAdmission = async (token: string, browserBinding?: string) => {
    const [payload, signature] = token.split('.')
    if (!payload || !signature || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[a-f0-9]{64}$/.test(signature) || !safeEqual(createHmac('sha256', input.tokenKey).update(payload).digest('hex'), signature)) return null
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown; exp?: unknown; typ?: unknown; bind?: unknown }
      if (claims.typ !== 'scisure-guest' || typeof claims.sub !== 'string' || typeof claims.exp !== 'number' || typeof claims.bind !== 'string' || claims.exp * 1000 <= now().getTime()) return null
      if (browserBinding !== undefined && (!browserBinding || browserBinding.length > 512 || !safeEqual(claims.bind, hash(browserBinding)))) return null
      const admission = await input.store.admissionForToken(hash(token), now().getTime())
      return admission?.subjectId === claims.sub ? admission : null
    } catch { return null }
  }
  return {
    requestEmailChallenge(inputValue: { address: string; captchaToken: string; ipSignal?: string }) { return issue(inputValue.address, inputValue.captchaToken, 'admission', inputValue.ipSignal) },
    requestRecovery(inputValue: { address: string; captchaToken: string; ipSignal?: string }) { return issue(inputValue.address, inputValue.captchaToken, 'recovery', inputValue.ipSignal) },
    async verifyEmailChallenge(inputValue: { fragmentToken: string; browserBinding: string }) {
      const challenge = await input.store.consumeChallenge(hash(inputValue.fragmentToken), now().getTime())
      if (!challenge) return { state: 'rejected' as const }
      if (challenge.expiresAt <= now().getTime()) return { state: 'expired' as const }
      if (!inputValue.browserBinding || inputValue.browserBinding.length > 512) return { state: 'rejected' as const }
      const admissionToken = signAdmission(challenge.subjectId, inputValue.browserBinding)
      await input.store.putAdmission({ tokenHash: hash(admissionToken), subjectId: challenge.subjectId, expiresAt: now().getTime() + ADMISSION_HOURS * 3_600_000 })
      const remaining = await input.store.remaining(challenge.subjectId, allowance)
      return { state: 'issued' as const, subjectId: challenge.subjectId, admissionToken, remaining }
    },
    async subjectForAdmission(admissionToken: string, browserBinding?: string) {
      const admission = await readAdmission(admissionToken, browserBinding)
      return admission?.subjectId || null
    },
    async reserveTrial(inputValue: { admissionToken: string; idempotencyKey: string }) {
      if (!REQUEST_ID.test(inputValue.idempotencyKey)) return { state: 'rejected' as const }
      const admission = await readAdmission(inputValue.admissionToken)
      if (!admission) return { state: 'rejected' as const }
      const outcome = await input.store.reserve(admission.subjectId, inputValue.idempotencyKey, allowance)
      return outcome === 'reserved' ? { state: 'reserved' as const, replayed: false } : outcome === 'replayed' ? { state: 'reserved' as const, replayed: true } : { state: 'exhausted' as const }
    },
    async claimToAccount(inputValue: { admissionToken: string; browserBinding?: string; authenticatedUserId: string | null; guestOwnedResultId: string }) {
      if (!inputValue.authenticatedUserId || !/^[A-Za-z0-9-]{8,128}$/.test(inputValue.authenticatedUserId) || !REQUEST_ID.test(inputValue.guestOwnedResultId) || !inputValue.browserBinding) return { state: 'rejected' as const }
      const admission = await readAdmission(inputValue.admissionToken, inputValue.browserBinding)
      if (!admission) return { state: 'rejected' as const }
      await input.store.claim(admission.subjectId, inputValue.authenticatedUserId, inputValue.guestOwnedResultId)
      return { state: 'claimed' as const, userId: inputValue.authenticatedUserId, resultId: inputValue.guestOwnedResultId }
    },
  }
}
