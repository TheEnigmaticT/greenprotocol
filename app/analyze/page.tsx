'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnalysisResult, ImpactDelta, Equivalency } from '@/lib/types'
import { findChemical } from '@/lib/chemicals'
import AnalysisResults from '@/components/AnalysisResults'
import ImpactScoreboard from '@/components/ImpactScoreboard'
import ScaleUpProjection from '@/components/ScaleUpProjection'
import UserMenu from '@/components/UserMenu'

interface StoredData {
  analysis: AnalysisResult
  impactDelta: ImpactDelta
  equivalencies: Equivalency[]
}

function calculateOriginalTotals(analysis: AnalysisResult) {
  let co2eKg = 0
  let hazWasteKg = 0
  let waterL = 0
  let energyKwh = 0

  for (const step of analysis.steps) {
    for (const chem of step.chemicals) {
      const data = findChemical(chem.name)
      if (!data) continue

      let qty = chem.quantityKg
      if (!qty && chem.quantityMl) {
        qty = (chem.quantityMl / 1000) * data.densityKgPerL
      }
      if (!qty) qty = chem.role === 'solvent' ? 0.5 : 0.1

      co2eKg += qty * data.co2ePerKg
      waterL += qty * data.waterPerKg
      energyKwh += qty * data.energyPerKg
      if (data.isHazardousWaste) hazWasteKg += qty
    }
  }

  return { co2eKg, hazWasteKg, waterL, energyKwh }
}

export default function AnalyzePage() {
  const [data, setData] = useState<StoredData | null>(null)
  const [protocol, setProtocol] = useState('')
  const router = useRouter()

  useEffect(() => {
    const stored = sessionStorage.getItem('gpc_analysis')
    const storedProtocol = sessionStorage.getItem('gpc_protocol')

    if (!stored) {
      router.push('/')
      return
    }

    try {
      setData(JSON.parse(stored))
      setProtocol(storedProtocol || '')
    } catch {
      router.push('/')
    }
  }, [router])

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
      {/* Header */}
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
        {/* Section A: Protocol Analysis */}
        <section>
          <AnalysisResults analysis={data.analysis} originalProtocol={protocol} />
        </section>

        {/* Section B: Impact Scoreboard */}
        <section className="border-t border-forest-800 pt-8">
          <ImpactScoreboard
            impactDelta={data.impactDelta}
            equivalencies={data.equivalencies}
            originalTotals={originalTotals}
          />
        </section>

        {/* Section C: Scale It Up */}
        <section className="border-t border-forest-800 pt-8">
          <ScaleUpProjection perRunDelta={data.impactDelta} />
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-forest-800 px-6 py-8 text-center">
        <p className="text-sm" style={{ color: '#a3a3a3' }}>
          Built for{' '}
          <span style={{ color: '#22C55E' }}>LabreNew.org</span>
          {' '}— Green chemistry recommendations require experimental validation before adoption.
        </p>
      </footer>
    </div>
  )
}
