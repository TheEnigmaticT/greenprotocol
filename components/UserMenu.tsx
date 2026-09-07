'use client'

import { createClient } from '@/lib/supabase/client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { NEW_ANALYSIS_HREF } from '@/lib/analysis-session'

function avatarInitials(user: User): string {
  const meta = user.user_metadata as Record<string, unknown> | undefined
  const name =
    (typeof meta?.full_name === 'string' && meta.full_name) ||
    (typeof meta?.name === 'string' && meta.name) ||
    ''
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  if (parts.length === 1 && parts[0].length > 0) {
    return parts[0][0].toUpperCase()
  }
  const local = user.email?.split('@')[0] ?? ''
  if (local.length >= 2) return local.slice(0, 2).toUpperCase()
  return (user.email?.[0] ?? 'U').toUpperCase()
}

export default function UserMenu({
  historyHref = '/dashboard',
  historyLabel = 'Dashboard',
  chrome = 'light',
}: {
  historyHref?: string
  historyLabel?: string
  /** light = cream pages; dark = forest AppShell header */
  chrome?: 'light' | 'dark'
}) {
  const [user, setUser] = useState<User | null>(null)
  const [open, setOpen] = useState(false)
  const [isDarkPage, setIsDarkPage] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user))
  }, [supabase.auth])

  useEffect(() => {
    if (rootRef.current) {
      setIsDarkPage(!!rootRef.current.closest('.dark-page'))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleSignOut() {
    setOpen(false)
    await supabase.auth.signOut()
    setUser(null)
    router.refresh()
  }

  const onDarkChrome = chrome === 'dark' || isDarkPage
  const triggerColor = onDarkChrome ? '#A8C5A2' : '#1C3822'
  const triggerBorder = onDarkChrome ? '#2D4A3A' : '#D6D0C4'
  const panelBg = '#F6F3EB'
  const panelBorder = '#D6D0C4'
  const itemColor = '#1C3822'
  const mutedColor = '#78716C'

  if (!user) {
    return (
      <div ref={rootRef}>
        <a
          href="/login"
          className="inline-flex items-center justify-center min-h-9 px-3 text-[12px] font-medium font-[family-name:var(--font-sans)] rounded-md border transition-colors"
          style={{ color: triggerColor, borderColor: triggerBorder }}
        >
          Sign In
        </a>
      </div>
    )
  }

  const initials = avatarInitials(user)
  // History and Dashboard are the same destination in this app; prefer one label.
  const accountHref = historyHref || '/dashboard'
  const accountLabel = historyLabel === 'History' ? 'Dashboard' : historyLabel || 'Dashboard'

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center justify-center w-9 h-9 rounded-full cursor-pointer shrink-0 border-0 p-0"
        style={{
          background: onDarkChrome ? '#F6F3EB' : '#1C3822',
          color: onDarkChrome ? '#1C3822' : '#F6F3EB',
        }}
      >
        <span
          className="text-[13px] font-semibold font-[family-name:var(--font-sans)] leading-none select-none"
          aria-hidden="true"
        >
          {initials}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 rounded-md shadow-lg z-50 py-1"
          style={{ background: panelBg, border: `1px solid ${panelBorder}` }}
        >
          <div className="px-3 py-2 border-b" style={{ borderColor: panelBorder }}>
            <p className="m-0 text-[11px] font-[family-name:var(--font-sans)] font-medium truncate" style={{ color: mutedColor }}>
              {user.email}
            </p>
          </div>
          <a
            role="menuitem"
            href={accountHref}
            className="block px-3 py-2.5 text-[13px] font-medium font-[family-name:var(--font-sans)] hover:bg-[#EFE9DF]"
            style={{ color: itemColor }}
            onClick={() => setOpen(false)}
          >
            {accountLabel}
          </a>
          <a
            role="menuitem"
            href={NEW_ANALYSIS_HREF}
            className="block px-3 py-2.5 text-[13px] font-medium font-[family-name:var(--font-sans)] hover:bg-[#EFE9DF]"
            style={{ color: itemColor }}
            onClick={() => setOpen(false)}
          >
            New Analysis
          </a>
          <button
            role="menuitem"
            type="button"
            onClick={handleSignOut}
            className="w-full text-left px-3 py-2.5 text-[13px] font-medium font-[family-name:var(--font-sans)] hover:bg-[#EFE9DF] cursor-pointer"
            style={{ color: mutedColor, background: 'transparent', border: 0 }}
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  )
}
