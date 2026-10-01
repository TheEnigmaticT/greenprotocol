'use client'

import { FormEvent, useState } from 'react'

const inputStyle = { width: '100%', boxSizing: 'border-box' as const, border: '1px solid #91a892', background: '#f6f3eb', color: '#0d1f16', borderRadius: 2, padding: '0.8rem', font: 'inherit' }

export function SciSurePartnerContactForm() {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setStatus(null)
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const payload = Object.fromEntries(form.entries()) as Record<string, string>
    payload.privacyAcknowledged = form.get('privacyAcknowledged') === 'on' ? 'true' : 'false'
    const body = { ...payload, privacyAcknowledged: payload.privacyAcknowledged === 'true', marketingConsent: form.get('marketingConsent') === 'on' }
    try {
      const response = await fetch('/api/partners/scisure/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Unable to submit this request.')
      formElement.reset()
      setStatus('Thanks. Your inquiry is saved and queued for the partnership team.')
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to submit this request.') }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit} style={{ display: 'grid', gap: '1rem' }} aria-label="SciSure partnership contact form">
    <label>Name<input required name="name" minLength={2} maxLength={120} autoComplete="name" style={inputStyle} /></label>
    <label>Work email<input required name="email" type="email" maxLength={320} autoComplete="email" style={inputStyle} /></label>
    <label>Organization <span aria-hidden="true">(optional)</span><input name="organization" maxLength={160} autoComplete="organization" style={inputStyle} /></label>
    <label>What would make a pilot useful?<textarea required name="message" minLength={10} maxLength={4000} rows={6} style={inputStyle} /></label>
    <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ display: 'none' }} />
    <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}><input required name="privacyAcknowledged" type="checkbox" /> <span>I understand this form is for partnership contact, not for submitting protocols or confidential procedures.</span></label>
    <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}><input name="marketingConsent" type="checkbox" /> <span>Optional: send me GreenChemistry.ai updates. I can unsubscribe anytime.</span></label>
    <button disabled={busy} type="submit" style={{ justifySelf: 'start', border: 0, background: '#ecb815', color: '#0d1f16', fontWeight: 800, padding: '0.9rem 1.2rem', cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Sending…' : 'Contact the pilot team'}</button>
    <p aria-live="polite" style={{ margin: 0, color: '#1c3822' }}>{status}</p>
  </form>
}
