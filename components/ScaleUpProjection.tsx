'use client'

import { useState, useMemo } from 'react'
import { ImpactDelta } from '@/lib/types'
import { calculateEquivalencies } from '@/lib/equivalencies'
import EquivalencyStory from './EquivalencyStory'

export default function ScaleUpProjection({ perRunDelta }: { perRunDelta: ImpactDelta }) {
  const [runsPerYear, setRunsPerYear] = useState(100)
  const [labsWorldwide, setLabsWorldwide] = useState(100)

  const annualDelta = useMemo((): ImpactDelta => ({
    co2eSavedKg: perRunDelta.co2eSavedKg * runsPerYear,
    hazardousWasteEliminatedKg: perRunDelta.hazardousWasteEliminatedKg * runsPerYear,
    carcinogensEliminated: perRunDelta.carcinogensEliminated,
    waterSavedL: perRunDelta.waterSavedL * runsPerYear,
    energySavedKwh: perRunDelta.energySavedKwh * runsPerYear,
  }), [perRunDelta, runsPerYear])

  const globalDelta = useMemo((): ImpactDelta => ({
    co2eSavedKg: annualDelta.co2eSavedKg * labsWorldwide,
    hazardousWasteEliminatedKg: annualDelta.hazardousWasteEliminatedKg * labsWorldwide,
    carcinogensEliminated: annualDelta.carcinogensEliminated,
    waterSavedL: annualDelta.waterSavedL * labsWorldwide,
    energySavedKwh: annualDelta.energySavedKwh * labsWorldwide,
  }), [annualDelta, labsWorldwide])

  const globalEquivalencies = useMemo(() => calculateEquivalencies(globalDelta), [globalDelta])

  function fmt(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    if (n >= 1) return n.toFixed(1)
    return n.toFixed(3)
  }

  return (
    <div className="space-y-8">
      <h2
        className="text-2xl font-bold font-[family-name:var(--font-serif)]"
        style={{ color: '#1C1917' }}
      >
        Scale It Up
      </h2>

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

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-3 rounded-lg border" style={{ background: '#F5F0E8', borderColor: '#D6D0C4' }}>
          <div className="text-xs mb-1" style={{ color: '#78716C' }}>Annual CO2e Saved</div>
          <div className="text-lg font-bold font-[family-name:var(--font-mono)]" style={{ color: '#16a34a' }}>
            {fmt(annualDelta.co2eSavedKg)} kg
          </div>
        </div>
        <div className="p-3 rounded-lg border" style={{ background: '#F5F0E8', borderColor: '#D6D0C4' }}>
          <div className="text-xs mb-1" style={{ color: '#78716C' }}>Global CO2e Saved</div>
          <div className="text-lg font-bold font-[family-name:var(--font-mono)]" style={{ color: '#1B4332' }}>
            {fmt(globalDelta.co2eSavedKg)} kg
          </div>
        </div>
        <div className="p-3 rounded-lg border" style={{ background: '#F5F0E8', borderColor: '#D6D0C4' }}>
          <div className="text-xs mb-1" style={{ color: '#78716C' }}>Global Haz. Waste Eliminated</div>
          <div className="text-lg font-bold font-[family-name:var(--font-mono)]" style={{ color: '#2563eb' }}>
            {fmt(globalDelta.hazardousWasteEliminatedKg)} kg
          </div>
        </div>
        <div className="p-3 rounded-lg border" style={{ background: '#F5F0E8', borderColor: '#D6D0C4' }}>
          <div className="text-xs mb-1" style={{ color: '#78716C' }}>Global Water Saved</div>
          <div className="text-lg font-bold font-[family-name:var(--font-mono)]" style={{ color: '#0891b2' }}>
            {fmt(globalDelta.waterSavedL)} L
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: '#78716C' }}>
          If {labsWorldwide.toLocaleString()} labs each run this {runsPerYear} times/year:
        </h3>
        <EquivalencyStory equivalencies={globalEquivalencies} variant="light" />
      </div>
    </div>
  )
}
