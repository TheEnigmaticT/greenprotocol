'use client'

import { useEffect, useId, useState } from 'react'

declare global { interface Window { turnstile?: { render(target: string | HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; theme?: 'light' | 'dark' }): string; remove(id: string): void } } }

type Props = { browserBinding: string; onAdmitted?: () => void }

export function GuestAdmission({ browserBinding, onAdmitted }: Props) {
  const widgetId = useId().replace(/:/g, '-')
  const [address, setAddress] = useState('')
  const [challenge, setChallenge] = useState('')
  const [message, setMessage] = useState('Verify your email to start one guest trial. Results are retained for up to 90 days.')
  const [busy, setBusy] = useState(false)
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  useEffect(() => {
    if (!sitekey) { setMessage('Guest admission is not configured. Sign in or ask the operator to configure the verification service.'); return }
    const load = () => window.turnstile?.render(`#${widgetId}`, { sitekey, theme: 'light', callback: setChallenge, 'expired-callback': () => setChallenge('') })
    if (window.turnstile) { load(); return }
    const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true; script.defer = true; script.onload = load; document.head.appendChild(script)
    return () => { script.remove() }
  }, [sitekey, widgetId])

  async function request(purpose: 'admission' | 'recovery') {
    setBusy(true)
    try {
      const response = await fetch('/api/integrations/scisure/guest/challenges', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ address, captchaToken: challenge, purpose }) })
      const result = await response.json() as { state?: string; error?: string }
      setMessage(result.state === 'queued' ? 'Check your mailbox for a one-time link. The link contains no email address.' : result.state === 'pending_configuration' ? 'Email delivery is not configured; no message was sent.' : result.error || 'Guest admission was not accepted.')
    } finally { setBusy(false) }
  }

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('guest')
    if (!token) return
    history.replaceState(null, '', `${location.pathname}${location.search}`)
    void (async () => {
      const response = await fetch('/api/integrations/scisure/guest/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ fragmentToken: token, browserBinding }) })
      const result = await response.json() as { state?: string; error?: string }
      if (result.state === 'issued') { setMessage('Guest admission verified. You can now connect SciSure and submit your one guest analysis.'); onAdmitted?.() }
      else setMessage(result.error || (result.state === 'expired' ? 'This recovery link expired. Request a new one.' : 'This recovery link was already used or is invalid.'))
    })()
  }, [browserBinding, onAdmitted])

  return <section aria-labelledby="guest-admission-heading" className="rounded border p-5" style={{ borderColor: '#D6D0C4' }}>
    <h2 id="guest-admission-heading" className="text-xl font-semibold">Guest SciSure analysis</h2>
    <p className="mt-2 text-sm" role="status">{message}</p>
    <label className="mt-4 block text-sm" htmlFor="guest-email">Email for one-time verification and optional result recovery</label>
    <input id="guest-email" type="email" autoComplete="email" value={address} onChange={(event) => setAddress(event.target.value)} className="mt-1 w-full rounded border p-2" />
    <div id={widgetId} className="mt-4" aria-label="Abuse-prevention verification" />
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy || !challenge} onClick={() => void request('admission')} className="rounded border px-3 py-2 disabled:opacity-50">Email verification link</button><button type="button" disabled={busy || !challenge} onClick={() => void request('recovery')} className="rounded border px-3 py-2 disabled:opacity-50">Recover a retained guest result</button></div>
    <p className="mt-3 text-xs">The verification challenge prevents automation; it does not identify you. We do not create a GreenChemistry.ai account, add 10 account generations, or opt you into marketing. A guest credential is short-lived; retained results may be recovered for 90 days after mailbox verification.</p>
  </section>
}
