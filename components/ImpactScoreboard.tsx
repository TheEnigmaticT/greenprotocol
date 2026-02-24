'use client'

import { ImpactDelta, Equivalency } from '@/lib/types'
import EquivalencyStory from './EquivalencyStory'

function Bar({
  label,
  originalValue,
  greenValue,
  unit,
  color,
}: {
  label: string
  originalValue: number
  greenValue: number
  unit: string
  color: string
}) {
  const max = Math.max(originalValue, greenValue, 0.001)
  const originalPct = (originalValue / max) * 100
  const greenPct = (greenValue / max) * 100

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span style={{ color: '#1C1917' }}>{label}</span>
        <span className="font-[family-name:var(--font-mono)]" style={{ color: '#78716C' }}>
          {originalValue.toFixed(2)} → {greenValue.toFixed(2)} {unit}
        </span>
      </div>
      <div className="space-y-1">
        <div className="h-6 rounded overflow-hidden" style={{ background: '#F0EBE1' }}>
          <div
            className="h-full rounded transition-all duration-1000 ease-out flex items-center px-2"
            style={{ width: `${originalPct}%`, background: '#FECACA', minWidth: originalPct > 0 ? '2rem' : '0' }}
          >
            <span className="text-xs whitespace-nowrap" style={{ color: '#991B1B' }}>Original</span>
          </div>
        </div>
        <div className="h-6 rounded overflow-hidden" style={{ background: '#F0EBE1' }}>
          <div
            className="h-full rounded transition-all duration-1000 ease-out flex items-center px-2"
            style={{ width: `${greenPct}%`, background: color, minWidth: greenPct > 0 ? '2rem' : '0' }}
          >
            <span className="text-xs whitespace-nowrap" style={{ color: '#FFFFFF' }}>Green</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ImpactScoreboard({
  impactDelta,
  equivalencies,
  originalTotals,
}: {
  impactDelta: ImpactDelta
  equivalencies: Equivalency[]
  originalTotals: {
    co2eKg: number
    hazWasteKg: number
    waterL: number
    energyKwh: number
  }
}) {
  return (
    <div className="space-y-8">
      <h2
        className="text-2xl font-bold font-[family-name:var(--font-serif)]"
        style={{ color: '#1C1917' }}
      >
        Impact Scoreboard
      </h2>

      <div className="space-y-6">
        <Bar
          label="Carbon Footprint"
          originalValue={originalTotals.co2eKg}
          greenValue={Math.max(0, originalTotals.co2eKg - impactDelta.co2eSavedKg)}
          unit="kg CO2e"
          color="#16a34a"
        />
        <Bar
          label="Hazardous Waste"
          originalValue={originalTotals.hazWasteKg}
          greenValue={Math.max(0, originalTotals.hazWasteKg - impactDelta.hazardousWasteEliminatedKg)}
          unit="kg"
          color="#2563eb"
        />
        <Bar
          label="Water Usage"
          originalValue={originalTotals.waterL}
          greenValue={Math.max(0, originalTotals.waterL - impactDelta.waterSavedL)}
          unit="L"
          color="#0891b2"
        />
        <Bar
          label="Energy Usage"
          originalValue={originalTotals.energyKwh}
          greenValue={Math.max(0, originalTotals.energyKwh - impactDelta.energySavedKwh)}
          unit="kWh"
          color="#D97706"
        />
      </div>

      <EquivalencyStory equivalencies={equivalencies} variant="light" />
    </div>
  )
}
