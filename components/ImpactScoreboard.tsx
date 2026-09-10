'use client'

import { useMemo } from 'react'
import { AnalysisResult, ImpactDelta } from '@/lib/types'
import { calculateEquivalencies } from '@/lib/equivalencies'
import { buildUnavailableImpact } from '@/lib/impact-inventory'

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
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row justify-between text-sm gap-1">
        <span style={{ color: '#1C1917' }}>{label}</span>
        <span className="font-[family-name:var(--font-mono)]" style={{ color: '#78716C' }}>
          {originalValue.toFixed(2)} → {greenValue.toFixed(2)} <span className="text-[10px] uppercase opacity-70">{unit}</span>
        </span>
      </div>
      <div className="space-y-1">
        <div className="h-6 rounded overflow-hidden" style={{ background: '#F0EBE1' }}>
          <div
            className="h-full rounded transition-all duration-1000 ease-out flex items-center px-2"
            style={{ width: `${originalPct}%`, background: '#FECACA', minWidth: originalPct > 0 ? '4rem' : '0' }}
          >
            <span className="text-[10px] font-bold uppercase tracking-tight" style={{ color: '#991B1B' }}>Original</span>
          </div>
        </div>
        <div className="h-6 rounded overflow-hidden" style={{ background: '#F0EBE1' }}>
          <div
            className="h-full rounded transition-all duration-1000 ease-out flex items-center px-2"
            style={{ width: `${greenPct}%`, background: color, minWidth: greenPct > 0 ? '4rem' : '0' }}
          >
            <span className="text-[10px] font-bold uppercase tracking-tight" style={{ color: '#FFFFFF' }}>Green</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function calculateAcceptedImpact(analysis: AnalysisResult): ImpactDelta {
  return buildUnavailableImpact(analysis, 'accepted')
}

export default function ImpactScoreboard({
  analysis,
  originalTotals,
}: {
  analysis: AnalysisResult
  originalTotals: {
    co2eKg: number
    hazWasteKg: number
    waterL: number
    energyKwh: number
  }
}) {
  const impact = useMemo(() => calculateAcceptedImpact(analysis), [analysis])
  const equivalencies = useMemo(() => calculateEquivalencies(impact), [impact])
  const acceptedCount = analysis.recommendations.filter(r => r.isAccepted === true).length
  const totalCount = analysis.recommendations.length

  if (impact.assessment?.level === 'unavailable') {
    return (
      <div className="space-y-2">
        <h2 className="text-2xl font-bold font-[family-name:var(--font-serif)]" style={{ color: '#1C1917' }}>
          Impact Scoreboard
        </h2>
        <p className="text-sm" style={{ color: '#78716C' }}>
          Impact comparison unavailable until the material boundary is complete.
        </p>
        <ul className="list-disc pl-5 text-sm space-y-1" style={{ color: '#78716C' }}>
          {impact.assessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
        {impact.inventory && (
          <details className="text-xs" style={{ color: '#78716C' }}>
            <summary className="cursor-pointer">Inspect submitted-batch inventory ({impact.inventory.baselineRows.length} baseline materials; {impact.inventory.afterRows.length} replacement scenarios)</summary>
            <p className="mt-1">{impact.inventory.boundary.limitations.join(' ')}</p>
          </details>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2
          className="text-2xl font-bold font-[family-name:var(--font-serif)]"
          style={{ color: '#1C1917' }}
        >
          Impact Scoreboard
        </h2>
        <p className="text-sm mt-1" style={{ color: '#78716C' }}>
          {acceptedCount === 0
            ? 'Accept recommendations to see projected environmental impact.'
            : `Based on ${acceptedCount} of ${totalCount} accepted recommendations.`}
        </p>
      </div>

      <div className="space-y-6">
        <Bar
          label="Carbon Footprint"
          originalValue={originalTotals.co2eKg}
          greenValue={Math.max(0, originalTotals.co2eKg - impact.co2eSavedKg)}
          unit="kg CO2e"
          color="#16a34a"
        />
        <Bar
          label="Hazardous Waste"
          originalValue={originalTotals.hazWasteKg}
          greenValue={Math.max(0, originalTotals.hazWasteKg - impact.hazardousWasteEliminatedKg)}
          unit="kg"
          color="#2563eb"
        />
        <Bar
          label="Water Usage"
          originalValue={originalTotals.waterL}
          greenValue={Math.max(0, originalTotals.waterL - impact.waterSavedL)}
          unit="L"
          color="#0891b2"
        />
        <Bar
          label="Energy Usage"
          originalValue={originalTotals.energyKwh}
          greenValue={Math.max(0, originalTotals.energyKwh - impact.energySavedKwh)}
          unit="kWh"
          color="#D97706"
        />
      </div>

      {/* Equivalency text — appears once there's something to show */}
      {equivalencies.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm" style={{ color: '#57534E' }}>
          {equivalencies.map((eq, i) => (
            <span key={i}>
              {eq.icon} <strong className="font-[family-name:var(--font-mono)]" style={{ color: '#1C3822' }}>{eq.value}</strong> {eq.description}
              {i < equivalencies.length - 1 && <span style={{ color: '#D6D0C4' }}> · </span>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Export the impact calculation for ScaleUpProjection to use.
 */
export { calculateAcceptedImpact }
