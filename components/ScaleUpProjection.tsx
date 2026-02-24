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
        style={{ color: '#F5F5F4' }}
      >
        Scale It Up
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-1">
          <label className="block text-sm" style={{ color: '#F5F5F4' }}>Runs per year</label>
          <input
            type="number"
            min={1}
            max={100000}
            value={runsPerYear}
            onChange={(e) => setRunsPerYear(Math.max(1, Number(e.target.value) || 1))}
            className="w-full px-3 py-2 rounded-lg border border-forest-700 font-[family-name:var(--font-mono)] text-sm focus:outline-none focus:border-amber-500"
            style={{ background: '#14532d', color: '#F59E0B' }}
          />
        </div>

        <div className="space-y-1">
          <label className="block text-sm" style={{ color: '#F5F5F4' }}>Labs worldwide</label>
          <input
            type="number"
            min={1}
            max={1000000}
            value={labsWorldwide}
            onChange={(e) => setLabsWorldwide(Math.max(1, Number(e.target.value) || 1))}
            className="w-full px-3 py-2 rounded-lg border border-forest-700 font-[family-name:var(--font-mono)] text-sm focus:outline-none focus:border-amber-500"
            style={{ background: '#14532d', color: '#F59E0B' }}
          />
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-3 rounded-lg border border-forest-800" style={{ background: '#14532d20' }}>
          <div className="text-xs mb-1" style={{ color: '#a3a3a3' }}>Annual CO2e Saved</div>
          <div className="text-lg font-bold font-[family-name:var(--font-mono)]" style={{ color: '#22C55E' }}>
            {fmt(annualDelta.co2eSavedKg)} kg
          </div>
        </div>
        <div className="p-3 rounded-lg border border-forest-800" style={{ background: '#14532d20' }}>
          <div className="text-xs mb-1" style={{ color: '#a3a3a3' }}>Global CO2e Saved</div>
          <div className="text-lg font-bold font-[family-name:var(--font-mono)]" style={{ color: '#F59E0B' }}>
            {fmt(globalDelta.co2eSavedKg)} kg
          </div>
        </div>
        <div className="p-3 rounded-lg border border-forest-800" style={{ background: '#14532d20' }}>
          <div className="text-xs mb-1" style={{ color: '#a3a3a3' }}>Global Haz. Waste Eliminated</div>
          <div className="text-lg font-bold font-[family-name:var(--font-mono)]" style={{ color: '#3B82F6' }}>
            {fmt(globalDelta.hazardousWasteEliminatedKg)} kg
          </div>
        </div>
        <div className="p-3 rounded-lg border border-forest-800" style={{ background: '#14532d20' }}>
          <div className="text-xs mb-1" style={{ color: '#a3a3a3' }}>Global Water Saved</div>
          <div className="text-lg font-bold font-[family-name:var(--font-mono)]" style={{ color: '#06B6D4' }}>
            {fmt(globalDelta.waterSavedL)} L
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: '#a3a3a3' }}>
          If {labsWorldwide.toLocaleString()} labs each run this {runsPerYear} times/year:
        </h3>
        <EquivalencyStory equivalencies={globalEquivalencies} />
      </div>
    </div>
  )
}
