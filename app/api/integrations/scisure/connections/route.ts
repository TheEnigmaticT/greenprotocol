import { NextResponse } from 'next/server'
import { createConnection } from '@/lib/integrations/scisure/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: Request) {
  try {
    const body = await request.json() as { nonce?: string; sourceOrigin?: string; guestAdmissionToken?: string }
    if (typeof body.nonce !== 'string' || typeof body.sourceOrigin !== 'string') throw new Error('Invalid connection request.')
    const connection = await createConnection({ nonce: body.nonce, origin: body.sourceOrigin, guestAdmissionToken: body.guestAdmissionToken })
    return NextResponse.json({ bridgeSessionId: connection.bridgeSessionId, credential: connection.credential, expiresAt: connection.expiresAt, principalKind: connection.principal.kind }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Connection unavailable.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
