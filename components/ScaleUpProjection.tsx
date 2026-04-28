'use client'

import { useState, useMemo } from 'react'
import { AnalysisResult, ImpactDelta } from '@/lib/types'
import { calculateEquivalencies } from '@/lib/equivalencies'
import { calculateAcceptedImpact } from './ImpactScoreboard'
import EquivalencyStory from './EquivalencyStory'

export default function ScaleUpProjection({ analysis }: { analysis: AnalysisResult }) {
  const [isOpen, setIsOpen] = useState(false)
  const [runsPerYear, setRunsPerYear] = useState(100)
  const [labsWorldwide, setLabsWorldwide] = useState(100)

  const perRunDelta = useMemo(() => calculateAcceptedImpact(analysis), [analysis])
  const hasImpact = perRunDelta.co2eSavedKg > 0 || perRunDelta.hazardousWasteEliminatedKg > 0 ||
    perRunDelta.waterSavedL > 0 || perRunDelta.energySavedKwh > 0

  const globalDelta = useMemo((): ImpactDelta => ({
    co2eSavedKg: perRunDelta.co2eSavedKg * runsPerYear * labsWorldwide,
    hazardousWasteEliminatedKg: perRunDelta.hazardousWasteEliminatedKg * runsPerYear * labsWorldwide,
    carcinogensEliminated: perRunDelta.carcinogensEliminated,
    waterSavedL: perRunDelta.waterSavedL * runsPerYear * labsWorldwide,
    energySavedKwh: perRunDelta.energySavedKwh * runsPerYear * labsWorldwide,
  }), [perRunDelta, runsPerYear, labsWorldwide])

  const globalEquivalencies = useMemo(() => calculateEquivalencies(globalDelta), [globalDelta])

  function fmt(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    if (n >= 1) return n.toFixed(1)
    return n.toFixed(3)
  }

  if (!hasImpact) return null

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-3 text-left group"
      >
        <div>
          <h2 className="text-lg font-semibold font-[family-name:var(--font-serif)]" style={{ color: '#1C1917' }}>
            Scale-Up Projection
          </h2>
          <p className="text-sm" style={{ color: '#78716C' }}>
            Model the cumulative impact of adopting these changes across multiple runs and laboratories.
          </p>
        </div>
        <span
          className="text-xl shrink-0 ml-4 transition-transform duration-200"
          style={{ color: '#78716C', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          ▾
        </span>
      </button>

      {isOpen && (
        <div className="space-y-6 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="block text-sm" style={{ color: '#57534E' }}>Runs per year</label>
              <input
                type="number"
                min={1}
                max={100000}
                value={runsPerYear}
                onChange={(e) => setRunsPerYear(Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-3 py-2 rounded-lg border font-[family-name:var(--font-mono)] text-sm focus:outline-none"
                style={{ background: '#F5F0E8', color: '#1C1917', borderColor: '#D6D0C4' }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#1B4332')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#D6D0C4')}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm" style={{ color: '#57534E' }}>Labs worldwide</label>
              <input
                type="number"
                min={1}
                max={1000000}
                value={labsWorldwide}
                onChange={(e) => setLabsWorldwide(Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-3 py-2 rounded-lg border font-[family-name:var(--font-mono)] text-sm focus:outline-none"
                style={{ background: '#F5F0E8', color: '#1C1917', borderColor: '#D6D0C4' }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#1B4332')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#D6D0C4')}
              />
            </div>
          </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg border" style={{ background: '#F5F0E8', borderColor: '#D6D0C4' }}>
              <div className="text-xs mb-1" style={{ color: '#78716C' }}>Global CO2e Saved</div>
              <div className="text-lg font-bold font-[family-name:var(--font-mono)]" style={{ color: '#16a34a' }}>
                {fmt(globalDelta.co2eSavedKg)} kg
              </div>
            </div>
            <div className="p-3 rounded-lg border" style={{ background: '#F5F0E8', borderColor: '#D6D0C4' }}>
              <div className="text-xs mb-1" style={{ color: '#78716C' }}>Haz. Waste Eliminated</div>
              <div className="text-lg font-bold font-[family-name:var(--font-mono)]" style={{ color: '#2563eb' }}>
                {fmt(globalDelta.hazardousWasteEliminatedKg)} kg
              </div>
            </div>
            <div className="p-3 rounded-lg border" style={{ background: '#F5F0E8', borderColor: '#D6D0C4' }}>
              <div className="text-xs mb-1" style={{ color: '#78716C' }}>Water Saved</div>
              <div className="text-lg font-bold font-[family-name:var(--font-mono)]" style={{ color: '#0891b2' }}>
                {fmt(globalDelta.waterSavedL)} L
              </div>
            </div>
            <div className="p-3 rounded-lg border" style={{ background: '#F5F0E8', borderColor: '#D6D0C4' }}>
              <div className="text-xs mb-1" style={{ color: '#78716C' }}>Energy Saved</div>
              <div className="text-lg font-bold font-[family-name:var(--font-mono)]" style={{ color: '#D97706' }}>
                {fmt(globalDelta.energySavedKwh)} kWh
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: '#78716C' }}>
              If {labsWorldwide.toLocaleString()} laboratories each run this protocol {runsPerYear.toLocaleString()} times per year:
            </h3>
            <EquivalencyStory equivalencies={globalEquivalencies} variant="light" />
          </div>
        </div>
      )}
    </div>
  )
}
