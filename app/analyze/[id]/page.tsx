'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { AnalysisResult, ImpactDelta, Equivalency } from '@/lib/types'
import type { RecommendationApprovalReceipt } from '@/components/TalkAboutThis'
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
}

export function reconcilePersistedRevision(
  current: AnalysisData | null,
  revisionNumber: number,
): AnalysisData | null {
  if (!current || revisionNumber < current.revisionNumber) return current
  return { ...current, revisionNumber }
}

export function applyRecommendationApproval(
  current: AnalysisData | null,
  receipt: RecommendationApprovalReceipt,
): AnalysisData | null {
  if (!current) return current
  const recommendationIndex = current.analysis.recommendations.findIndex(rec => rec.id === receipt.recommendationId)
  if (recommendationIndex === -1) return current
  const recommendations = [...current.analysis.recommendations]
  recommendations[recommendationIndex] = { ...recommendations[recommendationIndex], isAccepted: true }
  return {
    ...current,
    analysis: { ...current.analysis, recommendations },
    revisionNumber: Math.max(current.revisionNumber, receipt.revisionNumber),
  }
}

export default function AnalysisByIdPage() {
  const [data, setData] = useState<AnalysisData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRegrading, setIsRegrading] = useState(false)
  const [regradeError, setRegradeError] = useState<string | null>(null)
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
          setPersistError('This analysis changed elsewhere. Reload before making further changes.')
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
        setPersistError('Failed to save your recommendation decisions. Refresh carefully before leaving this page.')
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
        setError('Analysis not found')
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
          <p className="text-lg" style={{ color: '#EF4444' }}>{error}</p>
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

  const handleRecommendationApproved = (receipt: RecommendationApprovalReceipt) => {
    setData(current => applyRecommendationApproval(current, receipt))
  }

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
      setRegradeError('Unable to re-score this analysis. Please try again.')
    } finally {
      setIsRegrading(false)
    }
  }

  const quietGrade = buildQuietGradeLine(data.analysis)

  return (
    <AppShell analysisId={id} activeTab="decisions">
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
            analysisId={id}
            onRecommendationApproved={handleRecommendationApproved}
          />
        </section>

        {data.analysis.deterministicScores ? (
          <section className="p-5 sm:p-6 rounded-lg print:hidden" style={{ background: '#FAFAF8', border: '1px solid #D6D0C4' }}>
            <ScoreCard scores={data.analysis.deterministicScores} projectedScores={projectedScores} onRegrade={handleRegrade} isRegrading={isRegrading} analysisId={id} />
          </section>
        ) : data.analysis.chemistryDataStatus?.deterministicScoringAvailable === false ? (
          <DeterministicScoreRecovery onRetry={handleRegrade} isRetrying={isRegrading} error={regradeError} />
        ) : null}

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
