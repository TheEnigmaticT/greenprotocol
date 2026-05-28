'use client'

import { WasteAnalysis } from '@/lib/types'

const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  A: { bg: '#DCFCE7', text: '#166534' },
  B: { bg: '#D1FAE5', text: '#065F46' },
  C: { bg: '#FEF3C7', text: '#92400E' },
  D: { bg: '#FED7AA', text: '#9A3412' },
  F: { bg: '#FEE2E2', text: '#991B1B' },
}

export default function WasteScoreCard({
  wasteAnalysis,
  gcaiVersion,
}: {
  wasteAnalysis: WasteAnalysis
  gcaiVersion?: string
}) {
  const { summary } = wasteAnalysis
  const gc = GRADE_COLORS[summary.grade] || GRADE_COLORS.C

  return (
    <div
      className="p-4 rounded-lg border hover:border-[#16a34a] transition-colors cursor-pointer"
      style={{ background: '#FAFAF8', borderColor: '#D6D0C4' }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-4">
          <div
            className="flex items-center justify-center w-14 h-14 rounded-lg text-2xl font-bold shrink-0"
            style={{ background: gc.bg, color: gc.text }}
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
            {summary.wasteImpactScore}/10
          </span>
          <span
            className="text-[10px] px-2 py-0.5 rounded"
            style={{ background: '#F0EBE1', color: '#78716C' }}
          >
            {summary.confidence}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#E7E5E4]">
        {gcaiVersion && (
          <span className="text-[10px]" style={{ color: '#A8A29E' }}>
            GC.ai v{gcaiVersion}
          </span>
        )}
        <span
          className="text-[10px] font-bold uppercase tracking-tight"
          style={{ color: '#16a34a' }}
        >
          View Evidence →
        </span>
      </div>
    </div>
  )
}
