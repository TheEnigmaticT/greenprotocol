'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  classifyWorkspaceResponse, decisionLabel, findingEffectNote, findingKindLabel, retentionLabel, reviewProgress,
  type SavedWorkspaceLoad, replacementChemical,
} from '@/lib/integrations/scisure/saved-workspace-view'

const DECISION_COLOR: Record<string, string> = { Accepted: '#1C3822', Rejected: '#78716C', 'Not reviewed': '#B45309' }

export default function SavedWorkspace({ analysisId }: { analysisId: string }) {
  const [load, setLoad] = useState<SavedWorkspaceLoad | null>(null)
  const router = useRouter()

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/integrations/scisure/analyses/${analysisId}/workspace`, { signal: controller.signal })
      .then(classifyWorkspaceResponse)
      .then(result => { if (result.kind === 'signin') router.push('/login'); else setLoad(result) })
      .catch(() => { if (!controller.signal.aborted) setLoad({ kind: 'error' }) })
    return () => controller.abort()
  }, [analysisId, router])

  if (!load || load.kind === 'signin') {
    return <p role="status" className="m-0 text-sm" style={{ color: '#78716C' }}>Loading saved review...</p>
  }
  if (load.kind === 'unavailable') {
    return (
      <p role="alert" className="m-0 text-sm" style={{ color: '#44403C' }}>
        This saved SciSure review is not available. It may belong to another account, the retention period may have ended, or the analysis did not finish. Chemistry is never re-run to recover it.
      </p>
    )
  }
  if (load.kind === 'error') {
    return <p role="alert" className="m-0 text-sm" style={{ color: '#EF4444' }}>The saved review could not be loaded. Reload to try again.</p>
  }

  const { workspace } = load
  const progress = reviewProgress(workspace.findings)
  return (
    <div className="space-y-6">
      <header>
        <p className="m-0 mb-2 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: '#9D8026' }}>
          Saved SciSure review
        </p>
        <h1 className="text-[22px] sm:text-[26px] font-bold font-[family-name:var(--font-serif)] break-words leading-snug m-0" style={{ color: '#1C1917' }}>
          {workspace.source.title}
        </h1>
        <p className="mt-2.5 mb-0 font-[family-name:var(--font-mono)] text-[13px] tabular-nums break-words" style={{ color: '#44403C' }}>
          {progress.reviewed} of {progress.total} findings reviewed · revision {workspace.analysisRevision} · {retentionLabel(workspace.retentionExpiresAt)}
        </p>
        <p className="mt-2 mb-0 text-sm" style={{ color: '#78716C' }}>
          Read-only. Decisions and writeback to SciSure happen in the review popup, which needs a live connection. The analysis below is never re-run.
        </p>
      </header>

      <ul className="m-0 p-0 list-none space-y-4">
        {workspace.findings.map(finding => {
          const decision = decisionLabel(finding)
          return (
            <li key={finding.findingId} className="min-w-0 p-5 rounded-lg" style={{ background: '#FAFAF8', border: '1px solid #D6D0C4' }}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="m-0 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: '#9D8026' }}>
                  Step {finding.recommendation.stepNumber} · {findingKindLabel(finding)}
                </p>
                <p className="m-0 font-[family-name:var(--font-mono)] text-[12px] font-bold" style={{ color: DECISION_COLOR[decision] }}>{decision}</p>
              </div>
              <p className="mt-2 mb-0 font-[family-name:var(--font-mono)] text-[14px] break-words" style={{ color: '#1C1917' }}>
                {finding.recommendation.original.chemical}
                {replacementChemical(finding) ? ` → ${replacementChemical(finding)}` : ''}
              </p>
              <p className="mt-2 mb-0 text-sm break-words" style={{ color: '#44403C' }}>{finding.recommendation.original.issue}</p>
              {finding.recommendation.alternative.caveats && (
                <p className="mt-2 mb-0 text-sm break-words" style={{ color: '#78716C' }}>{finding.recommendation.alternative.caveats}</p>
              )}
              <p className="mt-3 mb-0 text-[13px]" style={{ color: '#44403C' }}>{findingEffectNote(finding)}</p>
            </li>
          )
        })}
      </ul>

      <p className="m-0 text-sm">
        <Link href={`/analyze/${analysisId}`} className="underline" style={{ color: '#1C3822' }}>Open the full analysis</Link>
      </p>
    </div>
  )
}
