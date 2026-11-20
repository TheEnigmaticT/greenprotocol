'use client'

import { useCallback, useEffect, useState } from 'react'
import EvidenceAtlas from '@/components/EvidenceAtlas'
import { TalkAboutThis } from '@/components/TalkAboutThis'
import type { PreparedSciSureWriteback, SciSureWorkspace, SciSureWorkspaceDecision, SciSureWorkspaceFinding, SciSureWritebackResult } from '@/lib/integrations/scisure/workspace-contract'
import {
  applyDecision, bridgeHeaders, buildWritebackMessage, canPrepareDraft, canRetryWriteback, newRequestId, parseWritebackResult,
  undecidedCount, UPDATE_UNAVAILABLE_NOTE, writebackTarget, type BridgeAuth,
} from '@/lib/integrations/scisure/popup-review'
import { decisionLabel, distinctRationale, findingEffectNote, findingKindLabel, replacementChemical, retentionLabel } from '@/lib/integrations/scisure/saved-workspace-view'

type Admitted = { externalId?: string; externalVersionId?: string | null; selection?: ReadonlyArray<{ sectionId?: string; stepId?: string; order: number }> }
type Writeback =
  | { phase: 'idle' }
  | { phase: 'sending'; requestId: string }
  | { phase: 'done'; requestId: string; result: SciSureWritebackResult }
  | { phase: 'timeout'; requestId: string }

const WRITEBACK_WAIT_MS = 65 * 60_000
const border = '#D6D0C4'
const button = 'min-h-11 rounded border px-4 py-2 text-sm font-medium disabled:opacity-50'

function errorText(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') return payload.error
  return fallback
}

export function ReviewWorkspace({ auth, snapshotId, nonce, admittedSource }: { auth: BridgeAuth; snapshotId: string; nonce: string; admittedSource: Admitted | undefined }) {
  const [workspace, setWorkspace] = useState<SciSureWorkspace | null>(null)
  const [findings, setFindings] = useState<SciSureWorkspaceFinding[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [draft, setDraft] = useState<PreparedSciSureWriteback | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [wb, setWb] = useState<Writeback>({ phase: 'idle' })
  const base = `/api/integrations/scisure/snapshots/${encodeURIComponent(snapshotId)}/workspace`

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(base, { credentials: 'same-origin', signal, headers: bridgeHeaders(auth) })
      const payload = await response.json() as SciSureWorkspace | { error?: string }
      if (!response.ok) throw new Error(errorText(payload, 'The private workspace could not be loaded.'))
      const loaded = payload as SciSureWorkspace
      setWorkspace(loaded); setFindings(loaded.findings); setLoadError(null); setDraft(null); setConfirmed(false)
    } catch (error) {
      if (!signal?.aborted) setLoadError(error instanceof Error ? error.message : 'The private workspace could not be loaded.')
    }
  }, [auth, base])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    if (wb.phase !== 'sending') return
    const requestId = wb.requestId
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== auth.sourceOrigin || event.source !== window.opener) return
      const result = parseWritebackResult(event.data, { nonce, bridgeSessionId: auth.sessionId, requestId })
      if (result) setWb({ phase: 'done', requestId, result })
    }
    window.addEventListener('message', onMessage)
    const timer = window.setTimeout(() => setWb({ phase: 'timeout', requestId }), WRITEBACK_WAIT_MS)
    return () => { window.removeEventListener('message', onMessage); window.clearTimeout(timer) }
  }, [wb, auth, nonce])

  const locked = wb.phase === 'sending' || wb.phase === 'timeout' || (wb.phase === 'done' && !canRetryWriteback(wb.result.status))

  async function decide(finding: SciSureWorkspaceFinding, decision: SciSureWorkspaceDecision) {
    if (!workspace || deciding || locked) return
    setDeciding(finding.findingId); setNotice(null)
    try {
      const response = await fetch(`${base}/decisions`, { method: 'POST', credentials: 'same-origin', headers: bridgeHeaders(auth, true), body: JSON.stringify({ sourceHash: workspace.sourceHash, analysisRevision: workspace.analysisRevision, findingId: finding.findingId, decision }) })
      const payload = await response.json() as { decision?: SciSureWorkspaceDecision; error?: string }
      if (!response.ok || payload.decision !== decision) {
        if (response.status === 409) void load()
        throw new Error(errorText(payload, 'Could not record the decision.'))
      }
      setFindings(current => applyDecision(current, finding.findingId, decision)); setDraft(null); setConfirmed(false)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not record the decision.') }
    finally { setDeciding(null) }
  }

  async function prepare() {
    if (!workspace || preparing || !canPrepareDraft(findings)) return
    setPreparing(true); setNotice(null); setConfirmed(false)
    try {
      const response = await fetch(`${base}/draft`, { method: 'POST', credentials: 'same-origin', headers: bridgeHeaders(auth, true), body: JSON.stringify({ sourceHash: workspace.sourceHash, analysisRevision: workspace.analysisRevision }) })
      const payload = await response.json() as PreparedSciSureWriteback | { error?: string }
      if (!response.ok) throw new Error(errorText(payload, 'The draft could not be prepared.'))
      setDraft(payload as PreparedSciSureWriteback)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'The draft could not be prepared.') }
    finally { setPreparing(false) }
  }

  function writeback() {
    if (!draft || !confirmed || locked || !window.opener) return
    const requestId = newRequestId()
    try {
      const message = buildWritebackMessage({ nonce, bridgeSessionId: auth.sessionId, requestId, source: admittedSource ?? {}, bundle: draft })
      window.opener.postMessage(message, auth.sourceOrigin)
      setWb({ phase: 'sending', requestId }); setNotice(null)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Nothing was sent to SciSure.') }
  }

  if (loadError) return <p role="alert" className="mt-6 text-sm" style={{ color: '#B91C1C' }}>{loadError} Nothing was returned to SciSure.</p>
  if (!workspace) return <p role="status" className="mt-6 text-sm">Loading the private review...</p>

  const registered = workspace.principalKind === 'registered' && Boolean(workspace.analysisId)
  const remaining = undecidedCount(findings)
  const target = writebackTarget(workspace.source.kind)
  return (
    <section className="mt-6 space-y-6" aria-label="Scientist review">
      <header>
        <h2 className="text-xl font-semibold">Scientist review</h2>
        <p className="mt-1 text-sm break-words" style={{ color: '#57534E' }}>
          {workspace.source.title} · {findings.length - remaining} of {findings.length} findings reviewed · {retentionLabel(workspace.retentionExpiresAt)}
        </p>
        <p className="mt-2 text-sm" style={{ color: '#57534E' }}>
          These findings are model-generated and scientifically unreviewed. Your decision is a review record, not proof a change will work. Only an accepted, application-eligible change alters the procedure text.
        </p>
      </header>

      {findings.length === 0 && <p className="text-sm">No findings were produced for this source.</p>}
      <ul className="m-0 list-none space-y-4 p-0">
        {findings.map(finding => {
          const { recommendation: rec } = finding
          const eligible = finding.applicable
          const note = notice && deciding === finding.findingId ? notice : null
          return (
            <li key={finding.findingId} className="min-w-0 rounded border p-4" style={{ borderColor: border }}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs font-bold uppercase tracking-wider">
                <span style={{ color: '#9D8026' }}>Step {rec.stepNumber} · {findingKindLabel(finding)} · {rec.severity} severity</span>
                <span style={{ color: finding.decision ? '#1C3822' : '#B45309' }}>{decisionLabel(finding)}</span>
              </div>
              <p className="mt-2 break-words text-base"><strong>{rec.original.chemical}</strong>{replacementChemical(finding) ? <> → <strong>{replacementChemical(finding)}</strong></> : null}</p>
              <p className="mt-2 break-words text-sm">{rec.original.issue}</p>
              {distinctRationale(finding) && <p className="mt-2 break-words text-sm">{distinctRationale(finding)}</p>}
              <p className="mt-2 break-words text-sm" style={{ color: '#57534E' }}>Confidence: {rec.confidenceLevel}. {rec.alternative.caveats}</p>
              <p className="mt-2 break-words text-sm" style={{ color: '#57534E' }}>Evidence basis: {rec.alternative.evidenceBasis}</p>
              <p className="mt-2 text-sm font-medium">{findingEffectNote(finding)}</p>
              {note && <p role="alert" className="mt-2 text-sm" style={{ color: '#B91C1C' }}>{note}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={button} style={{ borderColor: border }} aria-pressed={finding.decision === 'accepted'} disabled={Boolean(deciding) || locked || finding.decision === 'accepted'} onClick={() => void decide(finding, 'accepted')}>
                  {eligible ? 'Accept change' : 'Acknowledge'}
                </button>
                <button type="button" className={button} style={{ borderColor: border }} aria-pressed={finding.decision === 'rejected'} disabled={Boolean(deciding) || locked || finding.decision === 'rejected'} onClick={() => void decide(finding, 'rejected')}>
                  {eligible ? 'Reject change' : 'Dismiss'}
                </button>
                {registered && (
                  <TalkAboutThis
                    analysisId={workspace.analysisId}
                    scope={{ kind: 'recommendation', recommendationIndex: finding.recommendationIndex, readOnly: true }}
                    title={`Step ${rec.stepNumber}: ${rec.original.chemical}`}
                    evidenceState={rec.evidenceTier ?? ((rec.evidence?.citations.length ?? 0) > 0 ? 'sourced' : 'inferred')}
                    buttonLabel="Ask"
                    className="inline-flex min-h-11 items-center justify-center rounded border px-4 text-sm font-medium"
                    buttonStyle={{ borderColor: '#ECB815' }}
                  />
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {!registered && <p className="text-sm" style={{ color: '#57534E' }}>Ask and the Evidence Atlas require a signed-in account and are unavailable for this connection.</p>}

      {registered && workspace.analysis && (
        <details className="rounded border p-4" style={{ borderColor: border }}>
          <summary className="cursor-pointer text-sm font-semibold">Private Evidence Atlas</summary>
          <div className="mt-4"><EvidenceAtlas analysisId={workspace.analysisId!} analysis={workspace.analysis} embedded /></div>
        </details>
      )}

      <section className="space-y-3" aria-label="Reviewed draft">
        <h3 className="text-lg font-semibold">Reviewed draft</h3>
        {remaining > 0 && <p className="text-sm" style={{ color: '#57534E' }}>Review the remaining {remaining} finding{remaining === 1 ? '' : 's'} to prepare a draft.</p>}
        <button type="button" className={button} style={{ borderColor: border }} disabled={remaining > 0 || preparing || locked} onClick={() => void prepare()}>
          {preparing ? 'Preparing...' : draft ? 'Prepare again' : 'Prepare reviewed draft'}
        </button>
        {notice && deciding === null && <p role="alert" className="text-sm" style={{ color: '#B91C1C' }}>{notice}</p>}
        {draft && (
          <div className="space-y-3">
            <p className="text-sm">{draft.appliedFindingIds.length} change{draft.appliedFindingIds.length === 1 ? '' : 's'} applied, {draft.acknowledgedFindingIds.length} finding{draft.acknowledgedFindingIds.length === 1 ? '' : 's'} acknowledged only.</p>
            {draft.limitations.length > 0 && <ul className="list-disc pl-5 text-sm" aria-label="Draft limitations">{draft.limitations.map(limit => <li key={limit} className="break-words">{limit}</li>)}</ul>}
            <h4 className="text-sm font-semibold">{draft.title}</h4>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border p-3 text-sm" style={{ borderColor: border }}>{draft.draftText}</pre>
            <details><summary className="cursor-pointer text-sm font-semibold">Private evidence appendix</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border p-3 text-sm" style={{ borderColor: border }}>{draft.evidenceAppendixText}</pre></details>
          </div>
        )}
      </section>

      {draft && (
        <section className="space-y-3" aria-label="Write to SciSure">
          <h3 className="text-lg font-semibold">Write to SciSure</h3>
          <p className="text-sm">{target.description}</p>
          <p className="text-sm" style={{ color: '#57534E' }}>{UPDATE_UNAVAILABLE_NOTE}</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" checked={confirmed} disabled={locked} onChange={event => setConfirmed(event.target.checked)} /> I reviewed this draft and its evidence appendix and want a new {target.noun} created in SciSure.</label>
          <button type="button" className={button} style={{ borderColor: '#1C3822', background: '#1C3822', color: '#FAF8F3' }} disabled={!confirmed || locked || !window.opener} onClick={writeback}>
            Create new {target.noun} in SciSure
          </button>
          {wb.phase === 'sending' && <p role="status" className="text-sm">Waiting for SciSure. Choose the destination in the SciSure window if it asks. Do not retry.</p>}
          {wb.phase === 'timeout' && <p role="alert" className="text-sm" style={{ color: '#B45309' }}>No answer arrived from SciSure. The record may or may not exist: check SciSure before doing anything else. Nothing is retried automatically.</p>}
          {wb.phase === 'done' && (
            <p role={wb.result.status === 'saved' ? 'status' : 'alert'} className="text-sm" style={{ color: wb.result.status === 'saved' ? '#1C3822' : '#B45309' }}>
              {wb.result.status === 'saved' ? 'Saved.' : wb.result.status === 'uncertain' ? 'Uncertain.' : wb.result.status === 'conflict' ? 'Source changed.' : wb.result.status === 'unsupported' ? 'Not supported.' : 'Not written.'} {wb.result.message}
              {wb.result.targetId ? ` Record ID: ${wb.result.targetId}.` : ''}{canRetryWriteback(wb.result.status) ? ' No record was created; you may confirm and try again.' : ''}
            </p>
          )}
        </section>
      )}
    </section>
  )
}
