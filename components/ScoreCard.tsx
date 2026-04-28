'use client'

import { useState } from 'react'
import { PrincipleScore, DeterministicScores } from '@/lib/types'

const PRINCIPLE_SHORT_NAMES: Record<number, string> = {
  1: 'Waste Prevention',
  2: 'Atom Economy',
  3: 'Less Hazardous',
  4: 'Safer Products',
  5: 'Safer Solvents',
  6: 'Energy Efficiency',
  7: 'Renewable Feedstocks',
  8: 'Reduce Derivatives',
  9: 'Catalysis',
  10: 'Degradation',
  11: 'Real-Time Analysis',
  12: 'Accident Prevention',
}

const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  A: { bg: '#DCFCE7', text: '#166534' },
  B: { bg: '#D1FAE5', text: '#065F46' },
  C: { bg: '#FEF3C7', text: '#92400E' },
  D: { bg: '#FED7AA', text: '#9A3412' },
  F: { bg: '#FEE2E2', text: '#991B1B' },
}

function ScoreBar({ score }: { score: PrincipleScore }) {
  const [showDetails, setShowDetails] = useState(false)
  const isUnavailable = score.score < 0
  const pct = isUnavailable ? 0 : (score.score / 10) * 100

  // Color: green (low score = good) to red (high score = bad)
  const barColor = isUnavailable ? '#D6D0C4'
    : pct <= 30 ? '#16a34a'
    : pct <= 60 ? '#D97706'
    : '#DC2626'

  const confidenceLabel = score.confidence === 'calculated' ? ''
    : score.confidence === 'benchmark' ? '~'
    : score.confidence === 'estimated' ? '≈'
    : score.confidence === 'partial' ? '~'
    : '?'

  const shortName = PRINCIPLE_SHORT_NAMES[score.principle_number] || score.principle_name

  // Build tooltip content from details
  const reasoning = score.details?.reasoning as string | undefined
  const methodologyNote = score.details?.methodology_note as string | undefined
  const warnings = (score.details?.warnings as string[] | undefined) || score.compatibility_warnings

  return (
    <div className="space-y-1">
      <button
        onClick={() => !isUnavailable && setShowDetails(!showDetails)}
        className="w-full text-left group"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold shrink-0" style={{ color: '#1C1917' }}>
            P{score.principle_number}
          </span>
          <span className="text-xs truncate flex-1" style={{ color: '#57534E' }}>
            {shortName}
          </span>
          <span className="text-xs font-mono shrink-0 tabular-nums" style={{
            color: isUnavailable ? '#A8A29E' : barColor
          }}>
            {isUnavailable ? 'N/A' : `${confidenceLabel}${score.score.toFixed(1)}`}
          </span>
        </div>
        <div className="relative h-2 rounded-full overflow-hidden mt-0.5"
             style={{ background: '#F0EBE1' }}>
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
            style={{
              width: `${Math.max(isUnavailable ? 0 : pct, 2)}%`,
              background: barColor,
              opacity: isUnavailable ? 0.3 : 1,
            }}
          />
        </div>
      </button>

      {/* Expandable detail panel */}
      {showDetails && !isUnavailable && (
        <div className="mt-1 p-3 rounded-lg text-xs space-y-2"
             style={{ background: '#F5F0E8', border: '1px solid #D6D0C4' }}>
          {/* Confidence indicator */}
          {score.confidence !== 'calculated' && (
            <div className="flex items-start gap-1.5">
              <span style={{ color: '#D97706' }}>ℹ</span>
              <span style={{ color: '#78716C' }}>
                {score.confidence === 'estimated' && 'AI-assessed score — review reasoning below'}
                {score.confidence === 'benchmark' && 'Score estimated from industry benchmarks'}
                {score.confidence === 'partial' && 'Partial data available — some inputs missing'}
              </span>
            </div>
          )}

          {/* Reasoning (P11, P8) */}
          {reasoning && (
            <p style={{ color: '#1C1917' }}>{reasoning}</p>
          )}

          {/* Flagged chemicals */}
          {score.chemicals_flagged.length > 0 && (
            <div>
              <span className="font-semibold" style={{ color: '#DC2626' }}>Flagged: </span>
              <span style={{ color: '#57534E' }}>{score.chemicals_flagged.join(', ')}</span>
            </div>
          )}

          {/* Data sources */}
          <div style={{ color: '#A8A29E' }}>
            Sources: {score.data_sources.join(', ')}
          </div>

          {/* Warnings */}
          {warnings && warnings.length > 0 && (
            <div style={{ color: '#D97706' }}>
              {warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
            </div>
          )}

          {/* Methodology note */}
          {methodologyNote && (
            <p className="italic" style={{ color: '#A8A29E', fontSize: '0.65rem' }}>
              {methodologyNote}
            </p>
          )}
        </div>
      )}

      {/* Unavailable explanation */}
      {isUnavailable && (
        <p className="text-xs italic mt-0.5" style={{ color: '#A8A29E' }}>
          {(score.details?.error as string) || 'Data unavailable'}
        </p>
      )}
    </div>
  )
}


export default function ScoreCard({ scores, projectedScores, onRegrade, isRegrading }: {
  scores: DeterministicScores
  projectedScores?: DeterministicScores | null
  onRegrade?: () => void
  isRegrading?: boolean
}) {
  const gradeColor = GRADE_COLORS[scores.grade] || GRADE_COLORS.C
  const projGradeColor = projectedScores ? (GRADE_COLORS[projectedScores.grade] || GRADE_COLORS.C) : null
  const availableScores = scores.scores.filter(s => s.score >= 0)
  const unavailableScores = scores.scores.filter(s => s.score < 0)

  // Build a map of projected scores by principle number for comparison
  const projMap = new Map<number, PrincipleScore>()
  if (projectedScores) {
    for (const s of projectedScores.scores) {
      projMap.set(s.principle_number, s)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h3 className="text-lg font-semibold font-[family-name:var(--font-serif)]"
            style={{ color: '#1C1917' }}>
          Green Chemistry Scorecard
        </h3>
        <div className="flex items-center justify-between sm:justify-end gap-3 bg-white/50 p-2 sm:p-0 rounded-lg sm:bg-transparent">
          {projectedScores && projectedScores.grade !== scores.grade ? (
            <>
              <span className="text-sm" style={{ color: '#A8A29E' }}>
                <s>{scores.total_score.toFixed(1)}</s> → {projectedScores.total_score.toFixed(1)}/{projectedScores.max_possible.toFixed(0)}
              </span>
              <span
                className="text-lg font-bold px-2 py-0.5 rounded-lg line-through opacity-50"
                style={{ background: gradeColor.bg, color: gradeColor.text }}
              >
                {scores.grade}
              </span>
              <span className="text-xl" style={{ color: '#78716C' }}>→</span>
              <span
                className="text-2xl font-bold px-3 py-1 rounded-lg"
                style={{ background: projGradeColor!.bg, color: projGradeColor!.text }}
              >
                {projectedScores.grade}
              </span>
            </>
          ) : (
            <>
              <span className="text-sm" style={{ color: '#78716C' }}>
                {scores.total_score.toFixed(1)}/{scores.max_possible.toFixed(0)}
              </span>
              <span
                className="text-2xl font-bold px-3 py-1 rounded-lg"
                style={{ background: gradeColor.bg, color: gradeColor.text }}
              >
                {scores.grade}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs" style={{ color: '#A8A29E' }}>
        <span>Lower = greener</span>
        <span>· No symbol = calculated</span>
        <span>· ~ = benchmarked</span>
        <span>· ≈ = AI-estimated</span>
        {projectedScores && <span>· Green delta = projected improvement</span>}
        <span>· Click for details</span>
      </div>

      {/* Principle grid - and score bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
        {scores.scores
          .sort((a, b) => a.principle_number - b.principle_number)
          .map(s => {
            const proj = projMap.get(s.principle_number)
            const improved = proj && proj.score >= 0 && s.score >= 0 && proj.score < s.score
            return (
              <div key={s.principle_number} className="relative">
                <ScoreBar score={s} />
                {improved && (
                  <div className="absolute right-0 top-0 text-[10px] font-mono font-bold" style={{ color: '#16a34a' }}>
                    {(s.score - proj.score).toFixed(1)} ↓
                  </div>
                )}
              </div>
            )
          })
        }
      </div>

      {/* Summary footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between text-[10px] sm:text-xs pt-4 mt-2 border-t gap-4" style={{ borderColor: '#D6D0C4', color: '#78716C' }}>
        <div className="text-center sm:text-left">
          {availableScores.length} of 12 principles scored deterministically
          {unavailableScores.length > 0 && (
            <span> · {unavailableScores.length} need additional data</span>
          )}
          {projectedScores && (
            <span> · Projected from accepted recommendations</span>
          )}
        </div>
        {onRegrade && projectedScores && (
          <button
            onClick={onRegrade}
            disabled={isRegrading}
            className="text-[10px] sm:text-xs px-4 py-2 rounded border font-bold uppercase tracking-wider transition-colors disabled:opacity-50 w-full sm:w-auto"
            style={{ color: '#1B4332', borderColor: '#1B4332', background: 'white' }}
          >
            {isRegrading ? 'Re-grading...' : 'Re-grade with accepted changes'}
          </button>
        )}
      </div>
    </div>
  )
}
