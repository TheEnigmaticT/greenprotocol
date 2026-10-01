import { createHmac, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { createBridgeCredential, hashBridgeCredential } from './index'

const CONNECTION_MINUTES = 10
const GUEST_DAYS = 90

function configuredOrigins(): Set<string> {
  const raw = process.env.SCISURE_ALLOWED_ORIGINS || ''
  return new Set(raw.split(',').map((origin) => origin.trim()).filter(Boolean).map((origin) => new URL(origin).origin))
}
export function requireSciSureOrigin(origin: string | null) {
  if (!origin || !configuredOrigins().has(origin)) throw new Error('SciSure origin is not allowed.')
  return origin
}
function configuredAdmin() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SciSure integration is not configured.')
  return createAdminClient()
}
function future(minutes: number) { return new Date(Date.now() + minutes * 60_000).toISOString() }
function nonceHash(nonce: string) {
  const key = process.env.SCISURE_NONCE_HASH_KEY
  if (!key || key.length < 32) throw new Error('SciSure nonce protection is not configured.')
  return createHmac('sha256', key).update(nonce).digest('hex')
}

export type SciSurePrincipal = { id: string; kind: 'registered' | 'guest'; userId: string | null }
export async function authenticatedPrincipal(guestAdmissionToken?: string): Promise<SciSurePrincipal> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = configuredAdmin()
  if (user) {
    const { data, error } = await admin.from('gpc_scisure_principals').upsert({ user_id: user.id, kind: 'registered' }, { onConflict: 'user_id' }).select('id, kind, user_id').single()
    if (error || !data) throw new Error('Could not establish account integration principal.')
    return { id: data.id, kind: 'registered', userId: data.user_id }
  }
  if (!guestAdmissionToken) throw new Error('Sign in or present a verified guest admission token.')
  const secret = process.env.SCISURE_GUEST_ADMISSION_HMAC_KEY
  if (!secret) throw new Error('Guest admission is not configured.')
  const [payload, signature] = guestAdmissionToken.split('.')
  if (!payload || !signature || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[a-f0-9]{64}$/.test(signature)) throw new Error('Guest admission token is invalid.')
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new Error('Guest admission token is invalid.')
  let claims: { exp?: number; challenge?: string }
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) } catch { throw new Error('Guest admission token is invalid.') }
  const expiresAtSeconds = claims.exp
  if (typeof expiresAtSeconds !== 'number' || !Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds * 1000 <= Date.now() || typeof claims.challenge !== 'string' || claims.challenge.length < 16) throw new Error('Guest admission token expired or incomplete.')
  const tokenHash = await hashBridgeCredential(guestAdmissionToken)
  const { data, error } = await admin.from('gpc_scisure_principals').upsert({ kind: 'guest', guest_token_hash: tokenHash, expires_at: future(GUEST_DAYS * 24 * 60) }, { onConflict: 'guest_token_hash' }).select('id, kind, user_id').single()
  if (error || !data) throw new Error('Guest admission is unavailable; no principal was issued.')
  return { id: data.id, kind: 'guest', userId: null }
}

export async function createConnection(input: { nonce: string; origin: string; guestAdmissionToken?: string }) {
  const principal = await authenticatedPrincipal(input.guestAdmissionToken)
  const admin = configuredAdmin()
  const credential = createBridgeCredential()
  const { data, error } = await admin.from('gpc_scisure_connections').insert({
    principal_id: principal.id, owner_user_id: principal.userId, allowed_origin: requireSciSureOrigin(input.origin), nonce_hash: nonceHash(input.nonce),
    credential_id: credential.id, credential_hash: await hashBridgeCredential(credential.secret), expires_at: future(CONNECTION_MINUTES),
  }).select('id, expires_at').single()
  if (error || !data) throw new Error('Could not create a SciSure connection.')
  return { bridgeSessionId: data.id, credential: credential.secret, expiresAt: data.expires_at, principal }
}

export async function authorizeConnection(input: { bridgeSessionId: string; credential: string; origin: string; nonce?: string }) {
  const admin = configuredAdmin()
  const { data, error } = await admin.from('gpc_scisure_connections').select('id, principal_id, owner_user_id, allowed_origin, credential_hash, nonce_hash, expires_at, revoked_at').eq('id', input.bridgeSessionId).maybeSingle()
  if (error || !data || data.revoked_at || Date.parse(data.expires_at) <= Date.now() || data.allowed_origin !== requireSciSureOrigin(input.origin)) throw new Error('Connection is expired, revoked, or not authorized for this origin.')
  const supplied = await hashBridgeCredential(input.credential)
  if (!timingSafeEqual(Buffer.from(data.credential_hash), Buffer.from(supplied))) throw new Error('Connection credential is invalid.')
  if (input.nonce && !timingSafeEqual(Buffer.from(data.nonce_hash), Buffer.from(nonceHash(input.nonce)))) throw new Error('Connection nonce is invalid.')
  return { admin, connection: data }
}
