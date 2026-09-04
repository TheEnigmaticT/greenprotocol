import { notifySignup } from '@/lib/operational-alerts'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function ipLocation(request: Request): string | null {
  const city = optionalText(request.headers.get('x-vercel-ip-city'))
  const region = optionalText(request.headers.get('x-vercel-ip-country-region'))
  const country = optionalText(request.headers.get('x-vercel-ip-country'))
  const location = [city, region, country].filter(Boolean).map(value => {
    try { return decodeURIComponent(value!) } catch { return value! }
  })
  return location.length > 0 ? location.join(', ') : null
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const email = optionalText(body?.email)
  const password = optionalText(body?.password)
  const name = optionalText(body?.name)
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: name ? { full_name: name } : undefined },
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await notifySignup({
    name,
    email,
    timestamp: new Date().toISOString(),
    ipLocation: ipLocation(request),
  })
  return NextResponse.json({ ok: true })
}
