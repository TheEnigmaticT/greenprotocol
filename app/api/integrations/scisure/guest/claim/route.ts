import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { configuredGuestAdmissionService } from '@/lib/integrations/scisure/guest-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: Request) {
  try {
    const body = await request.json() as { jobId?: unknown }
    if (typeof body.jobId !== 'string') throw new Error('A guest-owned result is required.')
    const session = await createClient()
    const { data: { user } } = await session.auth.getUser()
    const token = (await cookies()).get('gcai_scisure_guest')?.value
    const result = await configuredGuestAdmissionService().claimToAccount({ admissionToken: token || '', authenticatedUserId: user?.id || null, guestOwnedResultId: body.jobId })
    return NextResponse.json(result, { status: result.state === 'claimed' ? 200 : 403, headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Guest account claim unavailable.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
