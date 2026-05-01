'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AnalysisResult, ImpactDelta, Equivalency } from '@/lib/types'
import { calculateOriginalTotals } from '@/lib/calculations'
import { projectScores } from '@/lib/projected-scores'
import ImpactScoreboard from '@/components/ImpactScoreboard'
import ScaleUpProjection from '@/components/ScaleUpProjection'
import FinalizedProtocol from '@/components/FinalizedProtocol'
import ScoreCard from '@/components/ScoreCard'
import UserMenu from '@/components/UserMenu'
import ChemistryDataNotice from '@/components/ChemistryDataNotice'
import ProtocolInput from '@/components/ProtocolInput'

interface StoredData {
  id?: string
  protocolText?: string
  analysis: AnalysisResult
  impactDelta: ImpactDelta
  equivalencies: Equivalency[]
}

export default function AnalyzePage() {
  const [data, setData] = useState<StoredData | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [persistError, setPersistError] = useState<string | null>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem('gpc_analysis')
    if (!stored) {
      setLoaded(true)
      return
    }

    try {
      const parsed = JSON.parse(stored)
      setData({
        ...parsed,
        protocolText: parsed.protocolText || sessionStorage.getItem('gpc_protocol') || undefined,
      })
    } catch {
      sessionStorage.removeItem('gpc_analysis')
    }
    setLoaded(true)
  }, [])

  // Debounced persist to Supabase when recommendations are accepted/rejected
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persistToApi = useCallback((analysisId: string, analysisResult: AnalysisResult) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/analyses/${analysisId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysis_result: analysisResult }),
        })
        if (!res.ok) {
          throw new Error(`PATCH /api/analyses/${analysisId} returned ${res.status}`)
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
    try {
      const res = await fetch('/api/rescore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis: data.analysis }),
      })
      if (res.ok) {
        const newScores = await res.json()
        const updatedAnalysis = { ...data.analysis, deterministicScores: newScores }
        handleUpdateAnalysis(updatedAnalysis)
      }
    } catch (err) {
      console.error('Re-grade failed:', err)
    } finally {
      setIsRegrading(false)
    }
  }, [data, handleUpdateAnalysis])

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAF8F3' }}>
        <div className="text-center space-y-4">
          <div className="animate-spin h-8 w-8 border-2 border-t-transparent rounded-full mx-auto" style={{ borderColor: '#1B4332', borderTopColor: 'transparent' }} />
          <p style={{ color: '#78716C' }}>Loading analysis...</p>
        </div>
      </div>
    )
  }

  if (!data || !originalTotals) {
    return (
      <div className="min-h-screen" style={{ background: '#FAF8F3' }}>
        <header className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
          <Link
            href="/"
            className="font-[family-name:var(--font-mono)] font-medium text-sm tracking-wide hover:opacity-80 transition-opacity"
            style={{ color: '#1B4332' }}
          >
            greenchemistry.ai
          </Link>
          <UserMenu />
        </header>

        <main className="max-w-5xl mx-auto px-6 py-10">
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold font-[family-name:var(--font-serif)]" style={{ color: '#1C1917' }}>
              Analyze a Protocol
            </h1>
            <p className="text-sm mt-2 max-w-2xl" style={{ color: '#78716C' }}>
              Paste a chemistry protocol to generate deterministic green chemistry scores and recommended substitutions.
            </p>
          </div>
          <ProtocolInput />
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: '#FAF8F3' }}>
      <header className="print:hidden flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <Link
          href="/"
          className="font-[family-name:var(--font-mono)] font-medium text-sm tracking-wide hover:opacity-80 transition-opacity"
          style={{ color: '#1B4332' }}
        >
          greenchemistry.ai
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <Link
            href="/"
            className="hidden sm:inline-block text-sm px-3 py-1.5 rounded-lg border transition-colors font-[family-name:var(--font-mono)]"
            style={{ color: '#1B4332', borderColor: '#D6D0C4' }}
          >
            New Analysis
          </Link>
          <UserMenu />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-12">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-[family-name:var(--font-serif)] break-words" style={{ color: '#1C1917' }}>
            {data.analysis.protocolTitle}
          </h1>
          <p className="text-sm mt-1" style={{ color: '#78716C' }}>{data.analysis.chemistrySubdomain}</p>
          {persistError && (
            <p className="text-sm mt-2" style={{ color: '#B45309' }}>
              {persistError}
            </p>
          )}
        </div>

        <ChemistryDataNotice status={data.analysis.chemistryDataStatus} />

        {data.analysis.deterministicScores && (
          <section className="p-6 rounded-xl print:hidden" style={{ background: '#FAFAF8', border: '1px solid #D6D0C4' }}>
            <ScoreCard scores={data.analysis.deterministicScores} projectedScores={projectedScores} onRegrade={handleRegrade} isRegrading={isRegrading} />
          </section>
        )}

        <section className="border-t pt-8" style={{ borderColor: '#D6D0C4' }}>
          <FinalizedProtocol
            analysis={data.analysis}
            originalProtocol={data.protocolText}
            onUpdateAnalysis={handleUpdateAnalysis}
          />
        </section>

        <section className="print:hidden border-t pt-8" style={{ borderColor: '#D6D0C4' }}>
          <ImpactScoreboard
            analysis={data.analysis}
            originalTotals={originalTotals}
          />
        </section>

        <section className="print:hidden border-t pt-8" style={{ borderColor: '#D6D0C4' }}>
          <ScaleUpProjection analysis={data.analysis} />
        </section>
      </main>

      <footer className="print:hidden border-t px-6 py-8 text-center" style={{ borderColor: '#D6D0C4' }}>
        <p className="text-sm" style={{ color: '#78716C' }}>
          Built for{' '}
          <span className="font-semibold" style={{ color: '#1B4332' }}>LabreNew.org</span>
          {' '}&mdash; Green chemistry recommendations require experimental validation before adoption.
        </p>
      </footer>
    </div>
  )
}
