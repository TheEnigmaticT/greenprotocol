'use client'

import { createClient } from '@/lib/supabase/client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  useEffect(() => {
    const msg = searchParams.get('message')
    if (msg === 'confirmed') {
      setMessage('Email confirmed! You can now sign in.')
    } else if (msg === 'reset') {
      setMessage('Password reset successful. Sign in with your new password.')
    }
    const err = searchParams.get('error')
    if (err === 'verification') {
      setError('Verification link expired or invalid. Please try signing up again.')
    } else if (err === 'auth') {
      setError('Authentication failed. Please try again.')
    }
  }, [searchParams])

  async function handleGoogleLogin() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) setError(error.message)
  }

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const authFn = isSignUp
      ? supabase.auth.signUp({ email, password })
      : supabase.auth.signInWithPassword({ email, password })

    const { error } = await authFn

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    if (isSignUp) {
      setError('Check your email for a confirmation link.')
      setLoading(false)
      return
    }

    router.push('/analyze')
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#FAF8F3' }}>
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold font-[family-name:var(--font-serif)]" style={{ color: '#1B4332' }}>
            GreenChemistry.ai
          </h1>
          <p className="mt-2 text-sm" style={{ color: '#78716C' }}>
            Sign in to analyze your protocols
          </p>
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-lg border focus:outline-none transition-colors"
            style={{ background: '#F5F0E8', color: '#1C1917', borderColor: '#D6D0C4' }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#1B4332')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#D6D0C4')}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full px-4 py-3 rounded-lg border focus:outline-none transition-colors"
            style={{ background: '#F5F0E8', color: '#1C1917', borderColor: '#D6D0C4' }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#1B4332')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#D6D0C4')}
          />

          {message && (
            <div className="p-3 rounded-lg text-sm" style={{ background: '#DCFCE7', color: '#166534' }}>
              ✓ {message}
            </div>
          )}

          {error && (
            <p className="text-sm" style={{ color: error.includes('Check your email') ? '#16a34a' : '#EF4444' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            style={{ background: '#7C2D36', color: '#FAF8F3' }}
          >
            {loading ? 'Loading...' : isSignUp ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-sm" style={{ color: '#78716C' }}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => { setIsSignUp(!isSignUp); setError(null) }}
            className="underline cursor-pointer font-semibold"
            style={{ color: '#7C2D36' }}
          >
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  )
}
