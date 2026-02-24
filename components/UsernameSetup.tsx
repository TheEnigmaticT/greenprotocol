'use client'

import { useState } from 'react'
import { GpcProfile } from '@/lib/types'

export default function UsernameSetup({ onComplete }: { onComplete: (profile: GpcProfile) => void }) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, display_name: displayName || undefined }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error)
      setLoading(false)
      return
    }

    onComplete(data.profile)
  }

  return (
    <div className="max-w-md mx-auto p-6 rounded-xl border border-forest-700" style={{ background: '#14532d20' }}>
      <h2 className="font-[family-name:var(--font-serif)] text-xl font-bold mb-2" style={{ color: '#F5F5F4' }}>
        Set up your profile
      </h2>
      <p className="text-sm mb-6" style={{ color: '#86efac' }}>
        Choose a username for your public impact profile.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm mb-1" style={{ color: '#a3a3a3' }}>Username</label>
          <div className="flex items-center rounded-lg border border-forest-700 overflow-hidden" style={{ background: '#14532d' }}>
            <span className="px-3 text-sm" style={{ color: '#a3a3a3' }}>greenchemistry.ai/u/</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              placeholder="your-username"
              className="flex-1 px-2 py-2 bg-transparent text-sm font-[family-name:var(--font-mono)] focus:outline-none"
              style={{ color: '#F5F5F4' }}
              maxLength={30}
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm mb-1" style={{ color: '#a3a3a3' }}>Display name (optional)</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Dr. Green"
            className="w-full px-3 py-2 rounded-lg border border-forest-700 bg-transparent text-sm focus:outline-none focus:border-amber-500"
            style={{ color: '#F5F5F4', background: '#14532d' }}
            maxLength={50}
          />
        </div>

        {error && (
          <p className="text-sm" style={{ color: '#EF4444' }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || username.length < 3}
          className="w-full px-4 py-2 rounded-lg font-semibold text-sm transition-all disabled:opacity-50 cursor-pointer"
          style={{ background: '#F59E0B', color: '#0A0F0D' }}
        >
          {loading ? 'Creating...' : 'Create Profile'}
        </button>
      </form>
    </div>
  )
}
