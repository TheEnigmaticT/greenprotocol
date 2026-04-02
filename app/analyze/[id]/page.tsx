'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { AnalysisResult, ImpactDelta, Equivalency } from '@/lib/types'
import { calculateOriginalTotals } from '@/lib/calculations'
import { projectScores } from '@/lib/projected-scores'
import ImpactScoreboard from '@/components/ImpactScoreboard'
import FinalizedProtocol from '@/components/FinalizedProtocol'
import ScoreCard from '@/components/ScoreCard'
import UserMenu from '@/components/UserMenu'

interface AnalysisData {
  id: string
  protocolText: string
  analysis: AnalysisResult
  impactDelta: ImpactDelta
  equivalencies: Equivalency[]
}

export default function AnalysisByIdPage() {
  const [data, setData] = useState<AnalysisData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  // Debounced persist to Supabase when recommendations are accepted/rejected
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persistToApi = useCallback((analysisId: string, analysisResult: AnalysisResult) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        await fetch(`/api/analyses/${analysisId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysis_result: analysisResult }),
        })
      } catch (err) {
        console.error('Failed to persist accepted recommendations:', err)
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
          <a href="/dashboard" className="text-sm underline" style={{ color: '#7C2D36' }}>
            Back to Dashboard
          </a>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAF8F3' }}>
        <div className="text-center space-y-4">
          <div className="animate-spin h-8 w-8 border-2 border-t-transparent rounded-full mx-auto" style={{ borderColor: '#1B4332', borderTopColor: 'transparent' }} />
          <p style={{ color: '#78716C' }}>Loading analysis...</p>
        </div>
      </div>
    )
  }

  const handleUpdateAnalysis = (updatedAnalysis: AnalysisResult) => {
    if (!data) return
    setData({ ...data, analysis: updatedAnalysis })
    persistToApi(id, updatedAnalysis)
  }

  const originalTotals = calculateOriginalTotals(data.analysis)
  const projectedScores = projectScores(data.analysis)

  return (
    <div className="min-h-screen" style={{ background: '#FAF8F3' }}>
      <header className="print:hidden flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <a
          href="/"
          className="font-[family-name:var(--font-mono)] font-medium text-sm tracking-wide hover:opacity-80 transition-opacity"
          style={{ color: '#1B4332' }}
        >
          greenchemistry.ai
        </a>
        <div className="flex items-center gap-2 sm:gap-4">
          <a
            href="/"
            className="hidden sm:inline-block text-sm px-3 py-1.5 rounded-lg border transition-colors font-[family-name:var(--font-mono)]"
            style={{ color: '#1B4332', borderColor: '#D6D0C4' }}
          >
            New Analysis
          </a>
          <UserMenu />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-12">
        {data.analysis.deterministicScores && (
          <section className="p-6 rounded-xl print:hidden" style={{ background: '#FAFAF8', border: '1px solid #D6D0C4' }}>
            <ScoreCard scores={data.analysis.deterministicScores} projectedScores={projectedScores} />
          </section>
        )}

        <section className="border-t pt-8" style={{ borderColor: '#D6D0C4' }}>
          <FinalizedProtocol analysis={data.analysis} onUpdateAnalysis={handleUpdateAnalysis} />
        </section>

        <section className="print:hidden border-t pt-8" style={{ borderColor: '#D6D0C4' }}>
          <ImpactScoreboard
            analysis={data.analysis}
            originalTotals={originalTotals}
          />
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
