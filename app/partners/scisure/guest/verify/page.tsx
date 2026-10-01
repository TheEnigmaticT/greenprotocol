'use client'

import { useEffect, useState } from 'react'

function browserBinding() {
  const key = 'gcai_scisure_guest_binding'
  const existing = window.localStorage.getItem(key)
  if (existing && existing.length <= 512) return existing
  const value = crypto.randomUUID()
  window.localStorage.setItem(key, value)
  return value
}

export default function GuestVerifyPage() {
  const [message, setMessage] = useState('Verifying your guest mailbox proof…')
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
    window.history.replaceState(null, '', window.location.pathname)
    if (!token) { void Promise.resolve().then(() => setMessage('This guest verification link is invalid. Request a new one.')); return }
    void (async () => {
      const response = await fetch('/api/integrations/scisure/guest/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ fragmentToken: token, browserBinding: browserBinding() }) })
      const result = await response.json() as { state?: string }
      setMessage(result.state === 'issued' ? 'Guest access verified. Return to the SciSure connection and continue in this browser.' : result.state === 'expired' ? 'This verification link expired. Request a new one.' : 'This verification link was already used or is invalid.')
    })()
  }, [])
  return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">SciSure guest verification</h1><p className="mt-3" role="status">{message}</p></main>
}
