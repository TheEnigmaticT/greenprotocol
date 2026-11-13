'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { WasteAnalysis } from '@/lib/types'
import WasteDetailsPanel from './WasteDetailsPanel'

const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  A: { bg: '#DCFCE7', text: '#166534' },
  B: { bg: '#D1FAE5', text: '#065F46' },
  C: { bg: '#FEF3C7', text: '#92400E' },
  D: { bg: '#FED7AA', text: '#9A3412' },
  F: { bg: '#FEE2E2', text: '#991B1B' },
}

// Neutral honest styling for a non-grade result. The new scorer may return
// 'INCOMPLETE' when waste mass cannot be computed; the UI must never render it
// as if it were a confident C-grade or display 0 kg as a real measurement.
const INCOMPLETE_GRADE_COLORS = { bg: '#E7E5E4', text: '#57534E' }
const INCOMPLETE_LABEL = 'INCOMPLETE'

export default function WasteScoreCard({
  wasteAnalysis,
  gcaiVersion,
  analysisId,
}: {
  wasteAnalysis: WasteAnalysis
  gcaiVersion?: string
  analysisId?: string
}) {
  const { summary } = wasteAnalysis
  const isIncomplete = summary.grade === INCOMPLETE_LABEL
  const isUnavailable = isIncomplete || summary.confidence === 'unavailable'
  const gc = isIncomplete
    ? INCOMPLETE_GRADE_COLORS
    : (GRADE_COLORS[summary.grade] || GRADE_COLORS.C)
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()

  // When mass is incomplete the kg figures must never be presented as a confident
  // measurement. A 0 here is the "we don't know" sentinel — not a real value.
  const massAvailable = !isUnavailable
    && Object.values(wasteAnalysis.directWaste).some(value => typeof value === 'number' && value > 0)

  return (
    <div
      className="rounded-lg border transition-colors"
      style={{ background: '#FAFAF8', borderColor: expanded ? '#16a34a' : '#D6D0C4' }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="w-full text-left p-4 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16a34a]"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-4">
            <div
              className="flex items-center justify-center w-14 h-14 rounded-lg text-2xl font-bold shrink-0"
              style={{ background: gc.bg, color: gc.text }}
              title={isIncomplete
                ? 'Incomplete coverage — solvent/use roles could not be fully classified.'
                : undefined}
              aria-label={isIncomplete
                ? 'Grade incomplete: solvent/use roles could not be fully classified.'
                : `Grade ${summary.grade}`}
            >
              {summary.grade}
            </div>

            <div className="min-w-0">
              <h3
                className="text-sm font-bold uppercase tracking-wider mb-0.5"
                style={{ color: '#1C1917' }}
              >
                Waste Impact
              </h3>
              <p className="text-xs" style={{ color: '#57534E' }}>
                {summary.primaryDriver}
              </p>
              {summary.bestNextAction && (
                <p className="text-xs mt-0.5" style={{ color: '#16a34a' }}>
                  → {summary.bestNextAction}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
            <span
              className="text-xs px-2.5 py-1 rounded-full font-semibold"
              style={{ background: gc.bg, color: gc.text }}
            >
              {isIncomplete
                ? `${INCOMPLETE_LABEL} · not a complete grade`
                : `${summary.wasteImpactScore}/10`}
            </span>
            <span
              className="text-[10px] px-2 py-0.5 rounded"
              style={{ background: '#F0EBE1', color: '#78716C' }}
              title={isUnavailable
                ? 'Coverage incomplete: kg figures below are not reliable measurements.'
                : undefined}
            >
              {summary.confidence}
              {!massAvailable && !isIncomplete && ' · mass unavailable'}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between mt-3 pt-2 border-t" style={{ borderColor: '#E7E5E4' }}>
          {gcaiVersion ? (
            <span className="text-[10px]" style={{ color: '#A8A29E' }}>
              GC.ai v{gcaiVersion}
            </span>
          ) : (
            <span />
          )}
          <span
            className="text-[10px] font-bold uppercase tracking-tight flex items-center gap-1"
            style={{ color: '#16a34a' }}
          >
            {expanded ? 'Hide breakdown' : 'Show breakdown'}
            <span aria-hidden className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>
              ▾
            </span>
          </span>
        </div>
      </button>

      {expanded && (
        <div id={panelId}>
          {/* Honest coverage caveat — never pretend an incomplete mass figure is a confident kg */}
          {isIncomplete && (
            <div
              className="mx-4 mt-3 p-3 rounded-lg text-xs"
              style={{ background: '#FAFAF8', border: '1px solid #D6D0C4', color: '#57534E' }}
              role="status"
            >
              <strong style={{ color: '#1C1917' }}>Waste mass unavailable:</strong>{' '}
              solvent/use role classification was not complete enough to compute kg figures.
              The 0 kg values shown below are placeholders for missing data, not real measurements.
            </div>
          )}
          {!isIncomplete && !massAvailable && (
            <div
              className="mx-4 mt-3 p-3 rounded-lg text-xs"
              style={{ background: '#FAFAF8', border: '1px solid #D6D0C4', color: '#57534E' }}
              role="status"
            >
              <strong style={{ color: '#1C1917' }}>Waste mass unavailable:</strong>{' '}
              role classification did not yield enough mass data to compute a confident total.
            </div>
          )}
          <WasteDetailsPanel wasteAnalysis={wasteAnalysis} />
          {analysisId && (
            <div className="px-4 pb-4">
              <Link
                href={`/analyze/${analysisId}/evidence#p1`}
                className="text-[10px] font-bold uppercase tracking-tight"
                style={{ color: '#16a34a' }}
              >
                Full Evidence Atlas →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
