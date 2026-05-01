'use client'

import { createClient } from '@/lib/supabase/client'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const message = (() => {
    const msg = searchParams.get('message')
    if (msg === 'confirmed') return 'Email confirmed! You can now sign in.'
    if (msg === 'reset') return 'Password reset successful. Sign in with your new password.'
    return null
  })()

  const searchError = (() => {
    const err = searchParams.get('error')
    if (err === 'verification') return 'Verification link expired or invalid. Please try signing up again.'
    if (err === 'auth') return 'Authentication failed. Please try again.'
    return null
  })()

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

          {(error || searchError) && (
            <p className="text-sm" style={{ color: (error || searchError || '').includes('Check your email') ? '#16a34a' : '#EF4444' }}>
              {error || searchError}
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

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAF8F3' }}>
        <div className="animate-spin h-8 w-8 border-2 border-t-transparent rounded-full" style={{ borderColor: '#1B4332', borderTopColor: 'transparent' }} />
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
