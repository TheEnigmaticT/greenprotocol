import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  // Handle token_hash confirmation (email confirm links use this format)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  const supabase = await createClient()

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'signup' | 'email' | 'recovery',
    })
    if (!error) {
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/login?message=reset`)
      }
      return NextResponse.redirect(`${origin}/login?message=confirmed`)
    }
    return NextResponse.redirect(`${origin}/login?error=verification`)
  }

  // Handle code exchange (OAuth and magic link flows)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
