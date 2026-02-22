'use client'

import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'

export default function UserMenu() {
  const [user, setUser] = useState<User | null>(null)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user))
  }, [supabase.auth])

  async function handleSignOut() {
    await supabase.auth.signOut()
    setUser(null)
    router.refresh()
  }

  if (!user) {
    return (
      <a
        href="/login"
        className="px-4 py-2 text-sm rounded-lg border border-forest-700 hover:border-forest-500 transition-colors"
        style={{ color: '#F5F5F4' }}
      >
        Sign In
      </a>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm truncate max-w-[200px]" style={{ color: '#86efac' }}>
        {user.email}
      </span>
      <button
        onClick={handleSignOut}
        className="px-3 py-1.5 text-sm rounded-lg border border-forest-700 hover:border-red-500 hover:text-red-400 transition-colors cursor-pointer"
        style={{ color: '#F5F5F4' }}
      >
        Sign Out
      </button>
    </div>
  )
}
