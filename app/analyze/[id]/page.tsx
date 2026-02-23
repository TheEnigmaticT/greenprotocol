'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { AnalysisResult, ImpactDelta, Equivalency } from '@/lib/types'
import { calculateOriginalTotals } from '@/lib/calculations'
import AnalysisResults from '@/components/AnalysisResults'
import ImpactScoreboard from '@/components/ImpactScoreboard'
import ScaleUpProjection from '@/components/ScaleUpProjection'
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
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0F0D' }}>
        <div className="text-center space-y-4">
          <p className="text-lg" style={{ color: '#EF4444' }}>{error}</p>
          <a href="/dashboard" className="text-sm underline" style={{ color: '#86efac' }}>
            Back to Dashboard
          </a>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0F0D' }}>
        <div className="text-center space-y-4">
          <div className="animate-spin h-8 w-8 border-2 border-t-transparent rounded-full mx-auto" style={{ borderColor: '#22C55E', borderTopColor: 'transparent' }} />
          <p style={{ color: '#86efac' }}>Loading analysis...</p>
        </div>
      </div>
    )
  }

  const originalTotals = calculateOriginalTotals(data.analysis)

  return (
    <div className="min-h-screen" style={{ background: '#0A0F0D' }}>
      <header className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <a
          href="/"
          className="font-[family-name:var(--font-serif)] font-bold text-lg hover:opacity-80 transition-opacity"
          style={{ color: '#22C55E' }}
        >
          GreenProtoCol
        </a>
        <div className="flex items-center gap-4">
          <a
            href="/dashboard"
            className="text-sm px-3 py-1.5 rounded-lg border border-forest-700 hover:border-amber-500 transition-colors"
            style={{ color: '#86efac' }}
          >
            Dashboard
          </a>
          <a
            href="/"
            className="text-sm px-3 py-1.5 rounded-lg border border-forest-700 hover:border-amber-500 transition-colors"
            style={{ color: '#86efac' }}
          >
            New Analysis
          </a>
          <UserMenu />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-12">
        <section>
          <AnalysisResults analysis={data.analysis} originalProtocol={data.protocolText} />
        </section>

        <section className="border-t border-forest-800 pt-8">
          <ImpactScoreboard
            impactDelta={data.impactDelta}
            equivalencies={data.equivalencies}
            originalTotals={originalTotals}
          />
        </section>

        <section className="border-t border-forest-800 pt-8">
          <ScaleUpProjection perRunDelta={data.impactDelta} />
        </section>
      </main>

      <footer className="border-t border-forest-800 px-6 py-8 text-center">
        <p className="text-sm" style={{ color: '#a3a3a3' }}>
          Built for{' '}
          <span style={{ color: '#22C55E' }}>LabreNew.org</span>
          {' '}&mdash; Green chemistry recommendations require experimental validation before adoption.
        </p>
      </footer>
    </div>
  )
}
