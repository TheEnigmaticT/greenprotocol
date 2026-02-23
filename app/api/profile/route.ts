import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data } = await supabase
    .from('gpc_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({ profile: data })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { username: string; display_name?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const username = body.username?.toLowerCase().trim()
  if (!username || !/^[a-z0-9][a-z0-9_-]{2,29}$/.test(username)) {
    return NextResponse.json(
      { error: 'Username must be 3-30 characters, start with a letter or number, and contain only lowercase letters, numbers, hyphens, or underscores.' },
      { status: 400 }
    )
  }

  // Check if user already has a profile
  const { data: existing } = await supabase
    .from('gpc_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (existing) {
    // Update existing profile
    const { data, error } = await supabase
      .from('gpc_profiles')
      .update({ username, display_name: body.display_name || null })
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Username is already taken.' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
    }

    return NextResponse.json({ profile: data })
  }

  // Create new profile
  const { data, error } = await supabase
    .from('gpc_profiles')
    .insert({
      user_id: user.id,
      username,
      display_name: body.display_name || null,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Username is already taken.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 })
  }

  return NextResponse.json({ profile: data }, { status: 201 })
}
