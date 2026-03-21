'use client'

import { createClient } from '@/lib/supabase/client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'

function useIsDarkPage() {
  const [isDark, setIsDark] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) {
      setIsDark(!!ref.current.closest('.dark-page'))
    }
  }, [])
  return { isDark, ref }
}

export default function UserMenu() {
  const [user, setUser] = useState<User | null>(null)
  const supabase = createClient()
  const router = useRouter()
  const { isDark, ref } = useIsDarkPage()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user))
  }, [supabase.auth])

  async function handleSignOut() {
    await supabase.auth.signOut()
    setUser(null)
    router.refresh()
  }

  const textColor = isDark ? '#86efac' : '#1B4332'
  const mutedColor = isDark ? '#86efac' : '#78716C'
  const borderColor = isDark ? '#15803d' : '#D6D0C4'

  if (!user) {
    return (
      <div ref={ref}>
        <a
          href="/login"
          className="px-4 py-2 text-sm rounded-lg border transition-colors font-[family-name:var(--font-mono)]"
          style={{ color: textColor, borderColor }}
        >
          Sign In
        </a>
      </div>
    )
  }

  return (
    <div ref={ref} className="flex items-center gap-2 sm:gap-3">
      <a
        href="/dashboard"
        className="hidden sm:inline-block text-sm px-3 py-1.5 rounded-lg border transition-colors font-[family-name:var(--font-mono)]"
        style={{ color: textColor, borderColor }}
      >
        Dashboard
      </a>
      <span className="hidden md:inline text-sm truncate max-w-[200px]" style={{ color: mutedColor }}>
        {user.email}
      </span>
      <button
        onClick={handleSignOut}
        className="px-3 py-1.5 text-sm rounded-lg border transition-colors cursor-pointer"
        style={{ color: mutedColor, borderColor }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#EF4444'; e.currentTarget.style.color = '#EF4444' }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = borderColor; e.currentTarget.style.color = mutedColor }}
      >
        Sign Out
      </button>
    </div>
  )
}
