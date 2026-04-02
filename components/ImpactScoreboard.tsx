'use client'

import { useMemo } from 'react'
import { AnalysisResult } from '@/lib/types'
import { findChemical } from '@/lib/chemicals'

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

function calculateAcceptedImpact(analysis: AnalysisResult) {
  let co2eSaved = 0
  let hazWasteSaved = 0
  let waterSaved = 0
  let energySaved = 0

  const accepted = analysis.recommendations.filter(r => r.isAccepted === true)

  for (const rec of accepted) {
    const originalData = findChemical(rec.original.chemical)
    const altData = findChemical(rec.alternative.chemical)
    if (!originalData) continue

    let quantityKg = 0
    const recNameLower = rec.original.chemical.toLowerCase()
    for (const step of analysis.steps) {
      if (step.stepNumber === rec.stepNumber) {
        for (const chem of step.chemicals) {
          const chemLower = chem.name.toLowerCase()
          const isMatch =
            chemLower === recNameLower ||
            chemLower.includes(recNameLower) ||
            recNameLower.includes(chemLower) ||
            (originalData.synonyms.some(s => chemLower.includes(s.toLowerCase())))
          if (isMatch) {
            if (chem.quantityKg) {
              quantityKg = chem.quantityKg
            } else if (chem.quantityMl) {
              quantityKg = (chem.quantityMl / 1000) * originalData.densityKgPerL
            } else {
              quantityKg = chem.role === 'solvent' ? 0.5 : 0.1
            }
          }
        }
      }
    }
    if (quantityKg === 0) quantityKg = 0.1

    const origCo2 = quantityKg * originalData.co2ePerKg
    const altCo2 = altData ? quantityKg * altData.co2ePerKg : 0
    co2eSaved += origCo2 - altCo2

    const origWater = quantityKg * originalData.waterPerKg
    const altWater = altData ? quantityKg * altData.waterPerKg : 0
    waterSaved += origWater - altWater

    const origEnergy = quantityKg * originalData.energyPerKg
    const altEnergy = altData ? quantityKg * altData.energyPerKg : 0
    energySaved += origEnergy - altEnergy

    if (originalData.isHazardousWaste) {
      hazWasteSaved += quantityKg
    }
  }

  return {
    co2eSavedKg: Math.max(0, co2eSaved),
    hazardousWasteEliminatedKg: Math.max(0, hazWasteSaved),
    waterSavedL: Math.max(0, waterSaved),
    energySavedKwh: Math.max(0, energySaved),
  }
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
  const acceptedCount = analysis.recommendations.filter(r => r.isAccepted === true).length
  const totalCount = analysis.recommendations.length

  return (
    <div className="space-y-8">
      <div>
        <h2
          className="text-2xl font-bold font-[family-name:var(--font-serif)]"
          style={{ color: '#1C1917' }}
        >
          Impact Scoreboard
        </h2>
        <p className="text-sm mt-1" style={{ color: '#78716C' }}>
          {acceptedCount === 0
            ? 'Accept recommendations above to see projected impact.'
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
    </div>
  )
}
