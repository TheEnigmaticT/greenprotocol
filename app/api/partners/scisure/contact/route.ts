import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { parsePartnerInquiry } from '@/lib/partner-inquiries'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const MAX_BYTES = 16_384

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  return Boolean(origin && host && new URL(origin).host === host)
}

export async function POST(request: Request) {
  try {
    const length = Number(request.headers.get('content-length') || '0')
    if (!request.headers.get('content-type')?.includes('application/json') || !sameOrigin(request) || !Number.isSafeInteger(length) || length > MAX_BYTES) {
      return NextResponse.json({ error: 'Invalid contact request.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
    }
    const body = await request.text()
    if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) return NextResponse.json({ error: 'Invalid contact request.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } })
    const inquiry = parsePartnerInquiry(JSON.parse(body))
    const emailHash = createHash('sha256').update(inquiry.email).digest('hex')
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('gpc_submit_partner_inquiry' as never, {
      p_name: inquiry.name, p_email: inquiry.email, p_email_hash: emailHash, p_organization: inquiry.organization,
      p_message: inquiry.message, p_marketing_consent: inquiry.marketingConsent,
    } as never)
    if (error || typeof data !== 'string') throw new Error(error?.message || 'Unable to save inquiry.')
    return NextResponse.json({ inquiryId: data, notification: 'queued' }, { status: 202, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error && /rate limit/i.test(error.message) ? 'Please wait before sending another message.' : 'Unable to submit this request.'
    return NextResponse.json({ error: message }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
}
