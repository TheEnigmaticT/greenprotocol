'use client'

import { useEffect, useRef, useState } from 'react'
import { GuestAdmission } from './GuestAdmission'
import { ReviewWorkspace } from './ReviewWorkspace'
import { bridgeHeaders, type BridgeAuth } from '@/lib/integrations/scisure/popup-review'

type Bridge = { nonce: string; sourceOrigin: string; sessionId: string; credential: string; principalKind: 'registered' | 'guest' }
type Source = { externalId?: string; externalVersionId?: string | null; selection?: Array<{ sectionId?: string; stepId?: string; order: number }> }
type Admission = { version: 1; type: 'scisure.gcai.admission'; nonce: string; bridgeSessionId: string; source?: Source }
type Status = { version: 1; bridgeSessionId: string; snapshotId: string; sourceHash: string; runId: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'uncertain' }
type Review = { auth: BridgeAuth; nonce: string; snapshotId: string; source: Source | undefined }

const POLL_MS = 1_500
const POLL_TIMEOUT_MS = 13 * 60_000

function allowedOrigin(value: string) {
  return (process.env.NEXT_PUBLIC_SCISURE_ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean).includes(value)
}
function errorText(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') return payload.error
  return fallback
}

export function ConnectionBridge() {
  const [message, setMessage] = useState('Waiting for a SciSure connection request.')
  const [review, setReview] = useState<Review | null>(null)
  const [guestAdmissionNeeded, setGuestAdmissionNeeded] = useState(false)
  const browserBinding = useRef(typeof window !== 'undefined' ? (() => { const key = 'gcai_scisure_guest_binding'; const existing = window.localStorage.getItem(key); if (existing && existing.length <= 512) return existing; const value = crypto.randomUUID(); window.localStorage.setItem(key, value); return value })() : 'guest-server-render')
  const bridge = useRef<Bridge | null>(null)
  const admitted = useRef(false)
  const failed = useRef(false)
  const pollAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!window.opener) { setMessage('This private page must be opened from the reviewed SciSure add-on.'); return }
    window.opener.postMessage({ version: 1, type: 'gcai.scisure.loaded' }, '*')
    const stopPolling = () => { pollAbort.current?.abort(); pollAbort.current = null }
    const fail = (reason: string) => {
      const active = bridge.current
      stopPolling(); setMessage(reason)
      if (active && !failed.current) { failed.current = true; window.opener.postMessage({ version: 1, type: 'gcai.scisure.failure', nonce: active.nonce, bridgeSessionId: active.sessionId, reason }, active.sourceOrigin) }
    }
    const poll = async (snapshotId: string, active: Bridge, source: Source | undefined) => {
      const controller = new AbortController(); pollAbort.current = controller
      const deadline = Date.now() + POLL_TIMEOUT_MS
      const auth: BridgeAuth = { sessionId: active.sessionId, credential: active.credential, sourceOrigin: active.sourceOrigin }
      while (!controller.signal.aborted && Date.now() < deadline) {
        try {
          const response = await fetch(`/api/integrations/scisure/snapshots/${encodeURIComponent(snapshotId)}/status`, { credentials: 'same-origin', signal: controller.signal, headers: bridgeHeaders(auth) })
          const payload: unknown = await response.json()
          if (!response.ok) throw new Error(errorText(payload, 'Status is unavailable.'))
          const current = payload as Status
          if (current.status === 'queued' || current.status === 'running') setMessage(current.status === 'queued' ? 'Source admitted. Analysis is queued; this connection remains open.' : 'Analysis is running; this connection remains open.')
          else if (current.status === 'completed') { setMessage('Analysis completed. Review every finding, then confirm before anything is written to SciSure.'); setReview({ auth, nonce: active.nonce, snapshotId, source }); return }
          else { fail(current.status === 'uncertain' ? 'Analysis outcome is uncertain. Nothing was returned to SciSure; do not retry automatically.' : 'Analysis failed. Nothing was returned to SciSure.'); return }
        } catch (error) { if (!controller.signal.aborted) fail(error instanceof Error ? error.message : 'Status is unavailable.'); return }
        const sleep = Promise.withResolvers<void>()
        window.setTimeout(sleep.resolve, POLL_MS)
        await sleep.promise
      }
      if (!controller.signal.aborted) fail('Analysis did not reach a terminal state before this private connection expired. Nothing was returned to SciSure.')
    }
    const receive = async (event: MessageEvent) => {
      if (!allowedOrigin(event.origin) || event.source !== window.opener || !event.data || typeof event.data !== 'object') return
      const data: { version?: unknown; type?: unknown; nonce?: unknown } = event.data
      if (data.version !== 1 || typeof data.type !== 'string') return
      if (data.type === 'scisure.gcai.hello') {
        const nonce = data.nonce
        if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce) || bridge.current) return
        try {
          const response = await fetch('/api/integrations/scisure/connections', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ nonce, sourceOrigin: event.origin }) })
          const payload: { bridgeSessionId?: string; credential?: string; error?: string; principalKind?: string } = await response.json()
          if (!response.ok || !payload.bridgeSessionId || !payload.credential || (payload.principalKind !== 'registered' && payload.principalKind !== 'guest')) {
            if (response.status === 403 && /sign in|verified guest admission/i.test(payload.error || '')) { setGuestAdmissionNeeded(true); setMessage('Sign in, or complete guest mailbox verification below. After verification, reopen this SciSure connection to repeat the handshake.'); return }
            throw new Error(payload.error || 'Connection unavailable.')
          }
          bridge.current = { nonce, sourceOrigin: event.origin, sessionId: payload.bridgeSessionId, credential: payload.credential, principalKind: payload.principalKind }
          window.opener.postMessage({ version: 1, type: 'gcai.scisure.ready', nonce, bridgeSessionId: payload.bridgeSessionId }, event.origin)
          setMessage('Signed-in connection ready. Review the selected source in SciSure, then submit it there.')
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Connection unavailable.') }
        return
      }
      if (data.type !== 'scisure.gcai.admission') return
      const admission: Admission = event.data; const active = bridge.current
      if (!active || admitted.current || admission.nonce !== active.nonce || admission.bridgeSessionId !== active.sessionId || failed.current) return
      admitted.current = true
      try {
        const response = await fetch('/api/integrations/scisure/snapshots', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${active.credential}`, 'X-GCAI-SciSure-Origin': active.sourceOrigin, 'Cache-Control': 'no-store' }, body: JSON.stringify(event.data) })
        const payload: { snapshotId?: string; status?: string; error?: string } = await response.json()
        if (!response.ok || !payload.snapshotId || payload.status !== 'queued') throw new Error(payload.error || 'Source admission failed.')
        setMessage('Source admitted. Analysis is queued; this connection remains open.'); void poll(payload.snapshotId, active, admission.source)
      } catch (error) { fail(error instanceof Error ? error.message : 'Source admission failed.') }
    }
    window.addEventListener('message', receive)
    return () => { stopPolling(); window.removeEventListener('message', receive) }
  }, [])

  return <main className="min-h-screen p-8" style={{ background: '#FAF8F3', color: '#1C3822' }}><section className="mx-auto max-w-3xl rounded-lg border p-6" style={{ borderColor: '#D6D0C4' }}>
    <h1 className="text-2xl font-semibold">SciSure connection</h1><p className="mt-4" role="status">{message}</p>
    {guestAdmissionNeeded && <GuestAdmission browserBinding={browserBinding.current} onAdmitted={() => setMessage('Guest mailbox proof is complete. Reopen the SciSure connection to start its fresh, origin-validated handshake.')} />}
    {review && <ReviewWorkspace auth={review.auth} nonce={review.nonce} snapshotId={review.snapshotId} admittedSource={review.source} />}
    <p className="mt-6 text-sm" style={{ color: '#57534E' }}>No connection credential is stored in browser storage or sent to SciSure. Source content is retained server-side for up to 90 days. Guest admission is unavailable until a configured, server-verified gate exists.</p>
  </section></main>
}
