'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

export function EmailPreferenceConfirmation() {
  const token = useSearchParams().get('token') || ''
  const [status, setStatus] = useState<string | null>(null)
  async function unsubscribe() {
    const response = await fetch('/api/partners/scisure/email-preferences', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
    const result = await response.json() as { error?: string }
    setStatus(response.ok ? 'You are unsubscribed from GreenChemistry.ai updates.' : result.error || 'Unable to update this preference.')
  }
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '1.5rem', background: '#f6f3eb', color: '#0d1f16' }}><section style={{ maxWidth: 620 }}><p style={{ fontFamily: 'var(--font-mono)', color: '#006d15' }}>EMAIL PREFERENCES</p><h1 style={{ fontFamily: 'var(--font-mono)', fontSize: 'clamp(2rem, 6vw, 4rem)', lineHeight: 0.95 }}>Stop marketing updates?</h1><p>This page has not changed your preferences. Confirm below to stop optional GreenChemistry.ai marketing email.</p><button onClick={unsubscribe} disabled={!token || Boolean(status)} style={{ border: 0, padding: '0.8rem 1rem', background: '#1c3822', color: '#f6f3eb', fontWeight: 800 }}>Unsubscribe</button><p aria-live="polite">{status}</p></section></main>
}
