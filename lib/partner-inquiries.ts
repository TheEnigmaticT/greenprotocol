export type PartnerInquiry = {
  name: string
  email: string
  organization: string | null
  message: string
  privacyAcknowledged: true
  marketingConsent: boolean
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const KEYS = new Set(['name', 'email', 'organization', 'message', 'privacyAcknowledged', 'marketingConsent', 'website'])

function text(value: unknown, label: string, min: number, max: number, required = true): string | null {
  if (typeof value !== 'string') {
    if (required) throw new Error(`${label} is required.`)
    return null
  }
  const normalized = value.trim()
  if (!normalized && !required) return null
  if (normalized.length < min || normalized.length > max) throw new Error(`${label} must be between ${min} and ${max} characters.`)
  return normalized
}

export function parsePartnerInquiry(value: unknown): PartnerInquiry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Contact request must be an object.')
  const input = value as Record<string, unknown>
  for (const key of Object.keys(input)) if (!KEYS.has(key)) throw new Error(`Unexpected field: ${key}.`)
  if (input.website !== undefined && input.website !== '') throw new Error('Unable to submit this request.')
  const name = text(input.name, 'Name', 2, 120)!
  const email = text(input.email, 'Email', 3, 320)!.toLowerCase()
  if (!EMAIL.test(email)) throw new Error('Email must be valid.')
  const organization = text(input.organization, 'Organization', 2, 160, false)
  const message = text(input.message, 'Message', 10, 4000)!
  if (input.privacyAcknowledged !== true) throw new Error('Privacy acknowledgement is required.')
  if (typeof input.marketingConsent !== 'boolean') throw new Error('Marketing consent must be a boolean.')
  return { name, email, organization, message, privacyAcknowledged: true, marketingConsent: input.marketingConsent }
}

export type PartnerInquiryStore = {
  persist(inquiry: PartnerInquiry): Promise<{ id: string; duplicate: boolean }>
  enqueue(input: { inquiryId: string; purpose: 'inquiry_notification' }): Promise<'queued' | 'pending_configuration'>
}

export async function createPartnerInquiry(inquiry: PartnerInquiry, store: PartnerInquiryStore) {
  const persisted = await store.persist(inquiry)
  const notification = await store.enqueue({ inquiryId: persisted.id, purpose: 'inquiry_notification' })
  return { id: persisted.id, notification }
}
