import { NextResponse } from 'next/server'
import { configuredGuestAdmissionService } from '@/lib/integrations/scisure/guest-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function requestBody(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid guest admission request.')
  const body = value as Record<string, unknown>
  if (typeof body.address !== 'string' || typeof body.captchaToken !== 'string') throw new Error('Email and accessibility challenge are required.')
  if (body.purpose !== undefined && body.purpose !== 'admission' && body.purpose !== 'recovery') throw new Error('Invalid guest admission purpose.')
  return { address: body.address, captchaToken: body.captchaToken, purpose: body.purpose === 'recovery' ? 'recovery' as const : 'admission' as const }
}

export async function POST(request: Request) {
  try {
    const body = requestBody(await request.json())
    const service = configuredGuestAdmissionService()
    const result = body.purpose === 'recovery'
      ? await service.requestRecovery(body)
      : await service.requestEmailChallenge(body)
    return NextResponse.json(result, { status: result.state === 'rejected' ? 400 : 202, headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Guest admission unavailable.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
