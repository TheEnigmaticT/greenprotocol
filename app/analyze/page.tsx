'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnalysisResult, ImpactDelta, Equivalency } from '@/lib/types'
import { calculateOriginalTotals } from '@/lib/calculations'
import { projectScores } from '@/lib/projected-scores'
import ImpactScoreboard from '@/components/ImpactScoreboard'
import ScaleUpProjection from '@/components/ScaleUpProjection'
import FinalizedProtocol from '@/components/FinalizedProtocol'
import ScoreCard from '@/components/ScoreCard'
import ChemistryDataNotice from '@/components/ChemistryDataNotice'
import DeterministicScoreRecovery from '@/components/DeterministicScoreRecovery'
import ProtocolInput from '@/components/ProtocolInput'
import AppShell from '@/components/AppShell'
import { NEW_ANALYSIS_HREF, clearAnalysisSession, resolveAnalysisSession } from '@/lib/analysis-session'
import { applyDeterministicScores, rescoreAnalysis } from '@/lib/rescore'
import { buildQuietGradeLine } from '@/lib/quiet-grade'

interface StoredData {
  id?: string
  protocolText?: string
  analysis: AnalysisResult
  impactDelta: ImpactDelta
  equivalencies: Equivalency[]
}

export default function AnalyzePage() {
  return (
    <Suspense fallback={<main className="min-h-screen" style={{ background: '#FAF8F3' }} />}>
      <AnalyzePageContent />
    </Suspense>
  )
}

function AnalyzePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const newAnalysisRequested = searchParams.get('new') === '1'
  const [data, setData] = useState<StoredData | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [persistError, setPersistError] = useState<string | null>(null)
  const [regradeError, setRegradeError] = useState<string | null>(null)

  function handleNewAnalysis() {
    const hasAccepted = data?.analysis.recommendations.some(r => r.isAccepted)
    if (hasAccepted) {
      // If analysis is saved to Supabase, offer to copy the link before clearing
      if (data?.id) {
        const analysisUrl = `${window.location.origin}/analyze/${data.id}`
        const message = `Starting a new analysis will clear your current results, including any accepted recommendations.\n\nThis analysis is saved. You can return to it later using this link:\n${analysisUrl}\n\nWould you like to copy the link to your clipboard before continuing?`
        
        if (window.confirm(message)) {
          navigator.clipboard.writeText(analysisUrl).catch(() => {
            // Fallback: show a prompt with the URL
            window.prompt('Copy this link to return to your analysis:', analysisUrl)
          })
        }
      } else {
        // No saved ID, just confirm
        if (!window.confirm('Starting a new analysis will clear your current results, including any accepted recommendations. Continue?')) return
      }
    }
    clearAnalysisSession(sessionStorage)
    router.push(NEW_ANALYSIS_HREF)
  }

  useEffect(() => {
    setData(resolveAnalysisSession<StoredData>({
      sessionStorage,
      searchParams: new URLSearchParams(newAnalysisRequested ? 'new=1' : ''),
    }))
    setPersistError(null)
    revisionRef.current = 1
    setLoaded(true)
  }, [newAnalysisRequested])

  // Debounced persist to Supabase when recommendations are accepted/rejected
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Optimistic-concurrency cursor. A freshly-analyzed row starts at revision 1
  // (gpc_analyses.revision_number DEFAULT 1); the PATCH route requires the
  // expected revision and a DB trigger enforces increment-by-one, so we must
  // send it and advance from each server response. Omitting it 400s every save.
  const revisionRef = useRef(1)

  const persistToApi = useCallback((analysisId: string, analysisResult: AnalysisResult) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/analyses/${analysisId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            analysis_result: analysisResult,
            expected_revision_number: revisionRef.current,
          }),
        })
        if (res.status === 409) {
          setPersistError('This analysis was updated elsewhere. Reload the page before saving more changes.')
          return
        }
        if (!res.ok) {
          throw new Error(`PATCH /api/analyses/${analysisId} returned ${res.status}`)
        }
        const payload = await res.json() as { revisionNumber?: number }
        if (typeof payload.revisionNumber === 'number') {
          revisionRef.current = payload.revisionNumber
        }
        setPersistError(null)
      } catch (err) {
        console.error('Failed to persist accepted recommendations:', err)
        setPersistError('Failed to save your recommendation decisions. Refresh carefully before leaving this page.')
      }
    }, 400)
  }, [])

  const handleUpdateAnalysis = useCallback((updatedAnalysis: AnalysisResult) => {
    if (!data) return
    const newData = { ...data, analysis: updatedAnalysis }
    setData(newData)
    sessionStorage.setItem('gpc_analysis', JSON.stringify(newData))

    // Persist to Supabase if we have an analysis ID
    if (data.id) {
      persistToApi(data.id, updatedAnalysis)
    }
  }, [data, persistToApi])

  const originalTotals = useMemo(
    () => data ? calculateOriginalTotals(data.analysis) : null,
    [data]
  )

  const projectedScores = useMemo(
    () => data ? projectScores(data.analysis) : null,
    [data]
  )

  const [isRegrading, setIsRegrading] = useState(false)

  const handleRegrade = useCallback(async () => {
    if (!data) return
    setIsRegrading(true)
    setRegradeError(null)
    try {
      const newScores = await rescoreAnalysis(data.analysis)
      handleUpdateAnalysis(applyDeterministicScores(data.analysis, newScores))
    } catch (err) {
      console.error('Re-grade failed:', err)
      setRegradeError('Unable to re-score this analysis. Please try again.')
    } finally {
      setIsRegrading(false)
    }
  }, [data, handleUpdateAnalysis])

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAF8F3' }}>
        <div role="status" aria-label="Loading analysis" className="text-center space-y-4">
          <div className="animate-spin h-8 w-8 border-2 border-t-transparent rounded-full mx-auto" style={{ borderColor: '#1C3822', borderTopColor: 'transparent' }} aria-hidden="true" />
          <p style={{ color: '#78716C' }}>Loading analysis...</p>
        </div>
      </div>
    )
  }

  if (!data || !originalTotals) {
    return (
      <AppShell historyLabel="Dashboard">
        <main id="main-content" className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold font-[family-name:var(--font-serif)]" style={{ color: '#1C1917' }}>
              Analyze a Protocol
            </h1>
            <p className="text-sm mt-2 max-w-2xl font-[family-name:var(--font-sans)]" style={{ color: '#78716C' }}>
              Paste a chemistry protocol to generate deterministic green chemistry scores and recommended substitutions.
            </p>
          </div>
          <ProtocolInput />
        </main>
      </AppShell>
    )
  }

  const quietGrade = buildQuietGradeLine(data.analysis)

  return (
    <AppShell analysisId={data.id} activeTab="decisions" onNewAnalysis={handleNewAnalysis}>
      <main id="main-content" className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-10">
        <header>
          <p className="m-0 mb-2 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: '#9D8026' }}>
            Protocol under review
          </p>
          <h1 className="text-[22px] sm:text-[26px] font-bold font-[family-name:var(--font-serif)] break-words leading-snug m-0" style={{ color: '#1C1917' }}>
            {data.analysis.protocolTitle}
          </h1>
          <p
            className="mt-2.5 mb-0 font-[family-name:var(--font-mono)] text-[13px] font-medium tabular-nums"
            style={{ color: '#44403C' }}
            role="status"
          >
            {quietGrade}
          </p>
          {persistError && (
            <p className="text-sm mt-2" style={{ color: '#B45309' }}>
              {persistError}
            </p>
          )}
        </header>

        <ChemistryDataNotice status={data.analysis.chemistryDataStatus} />

        <section>
          <FinalizedProtocol
            analysis={data.analysis}
            originalProtocol={data.protocolText}
            onUpdateAnalysis={handleUpdateAnalysis}
            analysisId={data.id}
          />
        </section>

        {data.analysis.deterministicScores ? (
          <section className="p-5 sm:p-6 rounded-lg print:hidden" style={{ background: '#FAFAF8', border: '1px solid #D6D0C4' }}>
            <ScoreCard scores={data.analysis.deterministicScores} projectedScores={projectedScores} onRegrade={handleRegrade} isRegrading={isRegrading} analysisId={data.id} />
          </section>
        ) : data.analysis.chemistryDataStatus?.deterministicScoringAvailable === false ? (
          <DeterministicScoreRecovery onRetry={handleRegrade} isRetrying={isRegrading} error={regradeError} />
        ) : null}

        <details className="print:hidden border-t pt-6" style={{ borderColor: '#D6D0C4' }}>
          <summary className="cursor-pointer list-none font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: '#9D8026' }}>
            Impact &amp; scale-up
          </summary>
          <div className="mt-6 space-y-10">
            <ImpactScoreboard analysis={data.analysis} originalTotals={originalTotals} />
            <ScaleUpProjection analysis={data.analysis} />
          </div>
        </details>
      </main>
    </AppShell>
  )
}
