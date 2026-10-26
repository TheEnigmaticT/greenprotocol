'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { AnalysisResult, ImpactDelta, Equivalency } from '@/lib/types'
import type { RecommendationDecisionReceipt } from '@/lib/talk-about-this/decisions'
import { applyRecommendationDecision } from '@/lib/talk-about-this/decisions'
import type { ProcedureProposal } from '@/lib/talk-about-this/procedure-proposal'
import { humanizeError, toHumanError, type HumanError } from '@/lib/errors/humanize'
import { rerunFromProposal } from '@/lib/rerun-from-proposal'
import { calculateOriginalTotals } from '@/lib/calculations'
import { projectScores } from '@/lib/projected-scores'
import ImpactScoreboard from '@/components/ImpactScoreboard'
import ScaleUpProjection from '@/components/ScaleUpProjection'
import FinalizedProtocol from '@/components/FinalizedProtocol'
import ScoreCard from '@/components/ScoreCard'
import ChemistryDataNotice from '@/components/ChemistryDataNotice'
import DeterministicScoreRecovery from '@/components/DeterministicScoreRecovery'
import AppShell from '@/components/AppShell'
import { applyDeterministicScores, rescoreAnalysis } from '@/lib/rescore'
import { buildQuietGradeLine } from '@/lib/quiet-grade'

export interface AnalysisData {
  id: string
  protocolText: string
  analysis: AnalysisResult
  impactDelta: ImpactDelta
  equivalencies: Equivalency[]
  revisionNumber: number
  /** True when a private SciSure review was saved for this analysis. */
  scisureReview?: boolean
}

export function reconcilePersistedRevision(
  current: AnalysisData | null,
  revisionNumber: number,
): AnalysisData | null {
  if (!current || revisionNumber < current.revisionNumber) return current
  return { ...current, revisionNumber }
}

export function applyDecisionReceipt(
  current: AnalysisData | null,
  receipt: RecommendationDecisionReceipt,
): AnalysisData | null {
  if (!current || !current.analysis.recommendations.some(rec => rec.id === receipt.recommendationId)) return current
  return {
    ...current,
    analysis: applyRecommendationDecision(current.analysis, receipt),
    revisionNumber: Math.max(current.revisionNumber, receipt.revisionNumber),
  }
}

export default function AnalysisByIdPage() {
  const [data, setData] = useState<AnalysisData | null>(null)
  const [error, setError] = useState<HumanError | null>(null)
  const [isRegrading, setIsRegrading] = useState(false)
  const [regradeError, setRegradeError] = useState<HumanError | null>(null)
  const [persistError, setPersistError] = useState<string | null>(null)
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  // Debounced persist to Supabase when recommendations are accepted/rejected
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persistToApi = useCallback((analysisId: string, analysisResult: AnalysisResult, expectedRevisionNumber: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/analyses/${analysisId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            analysis_result: analysisResult,
            expected_revision_number: expectedRevisionNumber,
          }),
        })
        if (res.status === 409) {
          setPersistError(humanizeError({ code: 'save_conflict' }).message)
          return
        }
        if (!res.ok) {
          throw new Error(`PATCH /api/analyses/${analysisId} returned ${res.status}`)
        }
        const payload = await res.json() as { revisionNumber: number }
        setData(current => current?.id === analysisId
          ? reconcilePersistedRevision(current, payload.revisionNumber)
          : current)
        setPersistError(null)
      } catch (err) {
        console.error('Failed to persist accepted recommendations:', err)
        setPersistError(humanizeError({ code: 'save_failed' }).message)
      }
    }, 400)
  }, [])

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/analyses/${id}`)
      if (res.status === 401) {
        router.push('/login')
        return
      }
      if (!res.ok) {
        setError(humanizeError({ code: res.status === 404 ? 'analysis_not_found' : 'analysis_load_failed' }))
        return
      }
      const json = await res.json()
      setData(json)
    }
    load()
  }, [id, router])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAF8F3' }}>
        <div className="text-center space-y-4">
          <p className="text-lg font-semibold" style={{ color: '#B91C1C' }}>{error.title}</p>
          <p className="text-sm max-w-md mx-auto" style={{ color: '#44403C' }}>{error.message}</p>
          <Link href="/dashboard" className="text-sm underline" style={{ color: '#1C3822' }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAF8F3' }}>
        <div className="text-center space-y-4">
          <div className="animate-spin h-8 w-8 border-2 border-t-transparent rounded-full mx-auto" style={{ borderColor: '#1C3822', borderTopColor: 'transparent' }} />
          <p style={{ color: '#78716C' }}>Loading analysis...</p>
        </div>
      </div>
    )
  }

  const handleUpdateAnalysis = (updatedAnalysis: AnalysisResult) => {
    if (!data) return
    const expectedRevisionNumber = data.revisionNumber
    setData({ ...data, analysis: updatedAnalysis })
    persistToApi(id, updatedAnalysis, expectedRevisionNumber)
  }

  const handleRecommendationDecided = (receipt: RecommendationDecisionReceipt) => {
    setData(current => applyDecisionReceipt(current, receipt))
  }

  const handleProcedureProposalApply = (proposal: ProcedureProposal) =>
    rerunFromProposal({ proposedText: proposal.proposedText, navigate: href => router.push(href), storage: sessionStorage })

  const originalTotals = calculateOriginalTotals(data.analysis)
  const projectedScores = projectScores(data.analysis)

  const handleRegrade = async () => {
    if (!data) return
    setIsRegrading(true)
    setRegradeError(null)
    try {
      const newScores = await rescoreAnalysis(data.analysis)
      handleUpdateAnalysis(applyDeterministicScores(data.analysis, newScores))
    } catch (err) {
      console.error('Re-grade failed:', err)
      setRegradeError(toHumanError(err, 'scoring_failed'))
    } finally {
      setIsRegrading(false)
    }
  }

  const quietGrade = buildQuietGradeLine(data.analysis)

  return (
    <AppShell analysisId={id} activeTab="decisions">
      <main id="main-content" className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-10">
        <header className="px-4 sm:px-5">
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
          {data.scisureReview && (
            <p className="mt-2 mb-0 text-sm">
              <Link href={`/analyze/${id}/scisure`} className="underline" style={{ color: '#1C3822' }}>
                Saved SciSure review
              </Link>
            </p>
          )}
          {persistError && (
            <p className="text-sm mt-2" style={{ color: '#B45309' }}>
              {persistError}
            </p>
          )}
        </header>

        <ChemistryDataNotice status={data.analysis.chemistryDataStatus} analysisId={id} onProcedureProposalApply={handleProcedureProposalApply} />

        <section>
          <FinalizedProtocol
            analysis={data.analysis}
            originalProtocol={data.protocolText}
            onUpdateAnalysis={handleUpdateAnalysis}
            analysisId={id}
            onRecommendationDecided={handleRecommendationDecided}
            onProcedureProposalApply={handleProcedureProposalApply}
            showProcedure={false}
          />
        </section>

        {data.analysis.deterministicScores ? (
          <section className="p-5 sm:p-6 rounded-lg print:hidden" style={{ background: '#FAFAF8', border: '1px solid #D6D0C4' }}>
            <ScoreCard scores={data.analysis.deterministicScores} projectedScores={projectedScores} onRegrade={handleRegrade} isRegrading={isRegrading} analysisId={id} />
          </section>
        ) : data.analysis.chemistryDataStatus?.deterministicScoringAvailable === false ? (
          <DeterministicScoreRecovery onRetry={handleRegrade} isRetrying={isRegrading} error={regradeError} analysisId={id} onProcedureProposalApply={handleProcedureProposalApply} />
        ) : null}

        <section>
          <FinalizedProtocol
            analysis={data.analysis}
            originalProtocol={data.protocolText}
            showRecommendations={false}
          />
        </section>

        <details className="print:hidden border-t pt-6 group" style={{ borderColor: '#D6D0C4' }}>
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
