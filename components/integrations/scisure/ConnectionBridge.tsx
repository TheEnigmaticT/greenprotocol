'use client'

import { useEffect, useRef, useState } from 'react'
import { GuestAdmission } from './GuestAdmission'

type Bridge = { nonce: string; sourceOrigin: string; sessionId: string; credential: string; principalKind: 'registered' | 'guest' }
type Source = { externalId?: string; externalVersionId?: string | null; selection?: Array<{ sectionId?: string; stepId?: string; order: number }> }
type Admission = { version: 1; type: 'scisure.gcai.admission'; nonce: string; bridgeSessionId: string; source?: Source }
type Recommendation = { recommendationId: string; originalChemical: string; alternativeChemical: string; kind: 'chemical-substitution'; decision: 'proposed' | 'accepted' | 'rejected'; confidence: 'high' | 'medium' | 'low'; caveats: string; requiresScientistReview: true }
type Status = { version: 1; bridgeSessionId: string; snapshotId: string; sourceHash: string; runId: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'uncertain'; revisionNumber?: number; recommendations?: Recommendation[] }
type Review = Record<string, 'approved_for_experiment' | 'rejected'>

const POLL_MS = 1_500
const POLL_TIMEOUT_MS = 9 * 60_000

function allowedOrigin(value: string) {
  return (process.env.NEXT_PUBLIC_SCISURE_ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean).includes(value)
}
function sourceIdentity(source: Source | undefined) {
  return { externalId: source?.externalId, externalVersionId: source?.externalVersionId || null, selectionIds: (source?.selection || []).map((selection) => selection.sectionId || selection.stepId || `#${selection.order}`) }
}
function errorText(payload: unknown, fallback: string) {
  return payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error?: unknown }).error === 'string' ? (payload as { error: string }).error : fallback
}

export function ConnectionBridge() {
  const [message, setMessage] = useState('Waiting for a SciSure connection request.')
  const [status, setStatus] = useState<Status | null>(null)
  const [reviews, setReviews] = useState<Review>({})
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [guestAdmissionNeeded, setGuestAdmissionNeeded] = useState(false)
  const browserBinding = useRef(typeof window !== 'undefined' ? (() => { const key = 'gcai_scisure_guest_binding'; const existing = window.localStorage.getItem(key); if (existing && existing.length <= 512) return existing; const value = crypto.randomUUID(); window.localStorage.setItem(key, value); return value })() : 'guest-server-render')
  const bridge = useRef<Bridge | null>(null)
  const admittedSource = useRef<Source | undefined>(undefined)
  const returned = useRef(false)
  const pollAbort = useRef<AbortController | null>(null)
  const sendResult = useRef<(current: Status, decisions: Review) => void>(() => undefined)

  useEffect(() => {
    if (!window.opener) { setMessage('This private page must be opened from the reviewed SciSure add-on.'); return }
    window.opener.postMessage({ version: 1, type: 'gcai.scisure.loaded' }, '*')
    const stopPolling = () => { pollAbort.current?.abort(); pollAbort.current = null }
    const fail = (reason: string) => {
      const active = bridge.current
      stopPolling(); setMessage(reason)
      if (active && !returned.current) { returned.current = true; window.opener.postMessage({ version: 1, type: 'gcai.scisure.failure', nonce: active.nonce, bridgeSessionId: active.sessionId, reason }, active.sourceOrigin) }
    }
    const returnResult = (current: Status, decisions: Review) => {
      const active = bridge.current
      if (!active || returned.current) return
      const recommendations = (current.recommendations || []).map((recommendation) => ({ ...recommendation, decision: decisions[recommendation.recommendationId] === 'approved_for_experiment' ? 'accepted' : 'rejected' }))
      returned.current = true; stopPolling()
      window.opener.postMessage({ version: 1, type: 'gcai.scisure.result', nonce: active.nonce, bridgeSessionId: active.sessionId, snapshot: sourceIdentity(admittedSource.current), sourceHash: current.sourceHash, runId: current.runId, revisionNumber: current.revisionNumber ?? null, recommendations }, active.sourceOrigin)
      setMessage(recommendations.length ? 'Scientist decisions returned to SciSure. Supply ordering remains a separate manual confirmation.' : 'Completed result returned to SciSure; no eligible substitution options were produced.')
    }
    sendResult.current = returnResult
    const poll = async (snapshotId: string, active: Bridge) => {
      const controller = new AbortController(); pollAbort.current = controller
      const deadline = Date.now() + POLL_TIMEOUT_MS
      while (!controller.signal.aborted && Date.now() < deadline) {
        try {
          const response = await fetch(`/api/integrations/scisure/snapshots/${encodeURIComponent(snapshotId)}/status`, { credentials: 'same-origin', signal: controller.signal, headers: { Authorization: `Bearer ${active.credential}`, 'X-GCAI-Bridge-Session': active.sessionId, 'X-GCAI-SciSure-Origin': active.sourceOrigin, 'Cache-Control': 'no-store' } })
          const payload = await response.json() as Status | { error?: string }
          if (!response.ok) throw new Error(errorText(payload, 'Status is unavailable.'))
          const current = payload as Status; setStatus(current)
          if (current.status === 'queued' || current.status === 'running') setMessage(current.status === 'queued' ? 'Source admitted. Analysis is queued; this connection remains open.' : 'Analysis is running; this connection remains open.')
          else if (current.status === 'completed') { if (!(current.recommendations || []).length) returnResult(current, {}); else setMessage('Analysis completed. A scientist must explicitly approve or reject every eligible alternative before anything returns to SciSure.'); return }
          else { fail(current.status === 'uncertain' ? 'Analysis outcome is uncertain. Nothing was returned to SciSure; do not retry automatically.' : 'Analysis failed. Nothing was returned to SciSure.'); return }
        } catch (error) { if (!controller.signal.aborted) fail(error instanceof Error ? error.message : 'Status is unavailable.'); return }
        await new Promise((resolve) => window.setTimeout(resolve, POLL_MS))
      }
      if (!controller.signal.aborted) fail('Analysis did not reach a terminal state before this private connection expired. Nothing was returned to SciSure.')
    }
    const receive = async (event: MessageEvent) => {
      if (!allowedOrigin(event.origin) || event.source !== window.opener || !event.data || typeof event.data !== 'object') return
      const data = event.data as { version?: number; type?: string; nonce?: string }
      if (data.version !== 1 || typeof data.type !== 'string') return
      if (data.type === 'scisure.gcai.hello') {
        if (!/^[a-f0-9]{64}$/.test(data.nonce || '') || bridge.current) return
        try {
          const response = await fetch('/api/integrations/scisure/connections', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ nonce: data.nonce, sourceOrigin: event.origin }) })
          const payload = await response.json() as { bridgeSessionId?: string; credential?: string; error?: string; principalKind?: string }
          if (!response.ok || !payload.bridgeSessionId || !payload.credential || (payload.principalKind !== 'registered' && payload.principalKind !== 'guest')) {
            if (response.status === 403 && /sign in|verified guest admission/i.test(payload.error || '')) { setGuestAdmissionNeeded(true); setMessage('Sign in, or complete guest mailbox verification below. After verification, reopen this SciSure connection to repeat the handshake.'); return }
            throw new Error(payload.error || 'Connection unavailable.')
          }
          bridge.current = { nonce: data.nonce!, sourceOrigin: event.origin, sessionId: payload.bridgeSessionId, credential: payload.credential, principalKind: payload.principalKind }
          window.opener.postMessage({ version: 1, type: 'gcai.scisure.ready', nonce: data.nonce, bridgeSessionId: payload.bridgeSessionId }, event.origin)
          setMessage('Signed-in connection ready. Review the selected source in SciSure, then submit it there.')
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Connection unavailable.') }
        return
      }
      if (data.type !== 'scisure.gcai.admission') return
      const admission = event.data as Admission; const active = bridge.current
      if (!active || admission.nonce !== active.nonce || admission.bridgeSessionId !== active.sessionId || returned.current) return
      try {
        const response = await fetch('/api/integrations/scisure/snapshots', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${active.credential}`, 'X-GCAI-SciSure-Origin': active.sourceOrigin, 'Cache-Control': 'no-store' }, body: JSON.stringify(event.data) })
        const payload = await response.json() as { snapshotId?: string; status?: string; error?: string }
        if (!response.ok || !payload.snapshotId || payload.status !== 'queued') throw new Error(payload.error || 'Source admission failed.')
        admittedSource.current = admission.source; setStatus(null); setReviews({}); setMessage('Source admitted. Analysis is queued; this connection remains open.'); void poll(payload.snapshotId, active)
      } catch (error) { fail(error instanceof Error ? error.message : 'Source admission failed.') }
    }
    window.addEventListener('message', receive)
    return () => { stopPolling(); window.removeEventListener('message', receive) }
  }, [])

  async function decide(recommendation: Recommendation, decision: Review[string]) {
    const active = bridge.current
    if (!active || !status || status.status !== 'completed' || reviewing) return
    setReviewing(recommendation.recommendationId)
    try {
      const decisionPath = active.principalKind === 'guest'
        ? `/api/integrations/scisure/guest/snapshots/${encodeURIComponent(status.snapshotId)}/decisions`
        : `/api/integrations/scisure/snapshots/${encodeURIComponent(status.snapshotId)}/decisions`
      const response = await fetch(decisionPath, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${active.credential}`, 'X-GCAI-Bridge-Session': active.sessionId, 'X-GCAI-SciSure-Origin': active.sourceOrigin, 'Cache-Control': 'no-store' }, body: JSON.stringify({ recommendationId: recommendation.recommendationId, decision, sourceHash: status.sourceHash, analysisRevision: status.revisionNumber ?? null }) })
      const payload = await response.json() as { decision?: Review[string]; error?: string }
      if (!response.ok || !payload.decision) throw new Error(payload.error || 'Could not record scientist decision.')
      setReviews((current) => ({ ...current, [recommendation.recommendationId]: payload.decision! }))
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not record scientist decision.') }
    finally { setReviewing(null) }
  }

  const recommendations = status?.status === 'completed' ? status.recommendations || [] : []
  const reviewed = recommendations.length > 0 && recommendations.every((recommendation) => reviews[recommendation.recommendationId])
  return <main className="min-h-screen p-8" style={{ background: '#FAF8F3', color: '#1C3822' }}><section className="mx-auto max-w-2xl rounded-lg border p-6" style={{ borderColor: '#D6D0C4' }}>
    <h1 className="text-2xl font-semibold">SciSure connection</h1><p className="mt-4" role="status">{message}</p>
    {guestAdmissionNeeded && <GuestAdmission browserBinding={browserBinding.current} onAdmitted={() => setMessage('Guest mailbox proof is complete. Reopen the SciSure connection to start its fresh, origin-validated handshake.')} />}
    {recommendations.length > 0 && <section className="mt-6 space-y-4" aria-label="Scientist review"><h2 className="text-xl font-semibold">Scientist review required</h2><p className="text-sm" style={{ color: '#57534E' }}>These are model-generated, scientifically unreviewed options. Approval does not place or authorize a supply order.</p>
      {recommendations.map((recommendation) => <article key={recommendation.recommendationId} className="rounded border p-4" style={{ borderColor: '#D6D0C4' }}><p><strong>{recommendation.originalChemical}</strong> → <strong>{recommendation.alternativeChemical}</strong></p><p className="mt-2 text-sm">Confidence: {recommendation.confidence}. {recommendation.caveats}</p><p className="mt-2 text-sm">Source hash: {status?.sourceHash}; run: {status?.runId}; revision: {status?.revisionNumber ?? 'durable result'}.</p><div className="mt-3 flex gap-2"><button type="button" disabled={!!reviewing || !!reviews[recommendation.recommendationId]} onClick={() => void decide(recommendation, 'approved_for_experiment')} className="rounded border px-3 py-2 disabled:opacity-50">Approve for experiment</button><button type="button" disabled={!!reviewing || !!reviews[recommendation.recommendationId]} onClick={() => void decide(recommendation, 'rejected')} className="rounded border px-3 py-2 disabled:opacity-50">Reject</button></div>{reviews[recommendation.recommendationId] && <p className="mt-2 text-sm">Recorded: {reviews[recommendation.recommendationId] === 'approved_for_experiment' ? 'approved for experiment' : 'rejected'}.</p>}</article>)}
      {reviewed && <button type="button" onClick={() => status && sendResult.current(status, reviews)} className="rounded border px-3 py-2">Return reviewed decisions to SciSure</button>}
    </section>}
    <p className="mt-6 text-sm" style={{ color: '#57534E' }}>No connection credential is stored in browser storage or sent to SciSure. Source content is retained server-side for up to 90 days. Guest admission is unavailable until a configured, server-verified gate exists.</p>
  </section></main>
}