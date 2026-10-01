import { NextResponse } from 'next/server'
import { configuredGuestAdmissionService } from '@/lib/integrations/scisure/guest-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: Request) {
  try {
    const body = await request.json() as { fragmentToken?: unknown; browserBinding?: unknown }
    if (typeof body.fragmentToken !== 'string' || typeof body.browserBinding !== 'string') throw new Error('Invalid guest verification request.')
    const result = await configuredGuestAdmissionService().verifyEmailChallenge({ fragmentToken: body.fragmentToken, browserBinding: body.browserBinding })
    if (result.state !== 'issued') return NextResponse.json(result, { status: result.state === 'expired' ? 410 : 400, headers: { 'Cache-Control': 'private, no-store' } })
    const response = NextResponse.json({ state: result.state, subjectId: result.subjectId, remaining: result.remaining }, { headers: { 'Cache-Control': 'private, no-store' } })
    response.cookies.set('gcai_scisure_guest', result.admissionToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/integrations/scisure', maxAge: 60 * 60 })
    response.cookies.set('gcai_scisure_guest_binding', body.browserBinding, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/integrations/scisure', maxAge: 60 * 60 })
    return response
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Guest verification unavailable.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
