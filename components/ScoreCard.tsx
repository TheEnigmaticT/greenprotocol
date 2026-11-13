'use client'

import { useState } from 'react'
import { PrincipleScore, DeterministicScores, ScoreProvenance } from '@/lib/types'
import { describeUnavailableScore } from '@/lib/errors/score-unavailable'

// Canonical provenance labels for UI display
const PROVENANCE_LABELS: Record<ScoreProvenance, string> = {
  'declared': 'declared',
  'calculated': 'calculated',
  'benchmark': 'benchmark-derived',
  'model-inferred': 'AI-estimated',
  'unavailable': 'unavailable',
}

const PROVENANCE_DESCRIPTIONS: Record<ScoreProvenance, string> = {
  'declared': 'Value explicitly stated in the protocol text',
  'calculated': 'Derived from chemical databases using deterministic formulas',
  'benchmark': 'Estimated from industry benchmark data (ACS GCI)',
  'model-inferred': 'AI-assessed score — review reasoning below',
  'unavailable': 'Score could not be computed — required data was missing',
}

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

// Neutral honest label for a non-grade result. The new scorer returns the literal
// string 'INCOMPLETE' when not enough was scored for a complete grade; the UI
// must never render it under the default grade C color (green-yellow) or as a
// passable headline score.
const INCOMPLETE_GRADE_COLORS = { bg: '#E7E5E4', text: '#57534E' }
const INCOMPLETE_LABEL = 'INCOMPLETE'

// A principle score is "unavailable" whenever the provenance says so OR the
// numeric score sentinel is -1. Old saved records can have score = 0 with
// confidence = 'unavailable' — never render that as a valid 0.
export function isUnavailableScore(s: PrincipleScore): boolean {
  if (s.confidence === 'unavailable') return true
  return s.score < 0
}

function ScoreBar({ score }: { score: PrincipleScore }) {
  const [showDetails, setShowDetails] = useState(false)
  const isUnavailable = isUnavailableScore(score)
  const pct = isUnavailable ? 0 : (score.score / 10) * 100

  // Color: green (low score = good) to red (high score = bad)
  const barColor = isUnavailable ? '#D6D0C4'
    : pct <= 30 ? '#16a34a'
    : pct <= 60 ? '#D97706'
    : '#DC2626'

  const confidenceLabel = score.confidence === 'calculated' ? ''
    : score.confidence === 'benchmark' ? '~'
    : score.confidence === 'model-inferred' ? '≈'
    : score.confidence === 'declared' ? '*'
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
                <strong>{PROVENANCE_LABELS[score.confidence]}:</strong>{' '}
                {PROVENANCE_DESCRIPTIONS[score.confidence]}
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
          {describeUnavailableScore(score.details)}
        </p>
      )}
    </div>
  )
}


export default function ScoreCard({ scores, projectedScores, onRegrade, isRegrading, analysisId }: {
  scores: DeterministicScores
  projectedScores?: DeterministicScores | null
  onRegrade?: () => void
  isRegrading?: boolean
  analysisId?: string
}) {
  const unavailableScores = scores.scores.filter(isUnavailableScore)
  const isIncomplete = scores.grade === INCOMPLETE_LABEL || scores.coverage?.partial === true
    || unavailableScores.length > 0 || scores.scores.length === 0
  const displayedGrade = isIncomplete ? INCOMPLETE_LABEL : scores.grade
  const projectedIncomplete = Boolean(projectedScores && (projectedScores.grade === INCOMPLETE_LABEL
    || projectedScores.coverage?.partial || projectedScores.scores.some(isUnavailableScore)))
  const projectedGrade = projectedIncomplete ? INCOMPLETE_LABEL : projectedScores?.grade
  const gradeColor = isIncomplete
    ? INCOMPLETE_GRADE_COLORS
    : (GRADE_COLORS[scores.grade] || GRADE_COLORS.C)
  const projGradeColor = projectedScores
    ? (projectedIncomplete
        ? INCOMPLETE_GRADE_COLORS
        : (GRADE_COLORS[projectedScores.grade] || GRADE_COLORS.C))
    : null
  // Counts have one source of truth, even if old coverage metadata is stale.
  const totalPrinciples = scores.scores.length
  const assessedCount = totalPrinciples - unavailableScores.length
  const deterministicCount = scores.scores.filter(s =>
    !isUnavailableScore(s) && (s.confidence === 'calculated' || s.confidence === 'declared'),
  ).length
  const aiAssessedCount = scores.scores.filter(s =>
    !isUnavailableScore(s) && s.confidence === 'model-inferred',
  ).length
  const benchmarkCount = scores.scores.filter(s =>
    !isUnavailableScore(s) && s.confidence === 'benchmark',
  ).length

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
        <div>
          <p className="m-0 mb-1 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: '#9D8026' }}>
            {assessedCount} of {totalPrinciples} principles assessed
          </p>
          <h3 className="text-lg font-semibold font-[family-name:var(--font-serif)] m-0"
              style={{ color: '#1C1917' }}>
            Green Chemistry Scorecard
          </h3>
        </div>
        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3">
          {analysisId && (
            <a
              href={`/analyze/${analysisId}/evidence`}
              aria-label="Open Evidence Atlas for this analysis"
              className="inline-flex items-center justify-center min-h-11 px-4 font-[family-name:var(--font-mono)] text-xs font-bold uppercase tracking-[0.12em] whitespace-nowrap order-last sm:order-first"
              style={{
                background: '#1C3822',
                color: '#F6F3EB',
                border: '1px solid #1C3822',
                textDecoration: 'none',
              }}
            >
              Open Evidence Atlas
            </a>
          )}
        <div className="flex items-center justify-between sm:justify-end gap-3 bg-white/50 p-2 sm:p-0 rounded-lg sm:bg-transparent">
          {projectedScores && projectedGrade !== displayedGrade ? (
            <>
              <span className="text-sm" style={{ color: '#A8A29E' }}>
                <s>{scores.total_score.toFixed(1)}</s> → {projectedScores.total_score.toFixed(1)}/{projectedScores.max_possible.toFixed(0)}
              </span>
              <span
                className="text-lg font-bold px-2 py-0.5 rounded-lg line-through opacity-50"
                style={{ background: gradeColor.bg, color: gradeColor.text }}
              >
                {displayedGrade}
              </span>
              <span className="text-xl" style={{ color: '#78716C' }}>→</span>
              <span
                className="text-2xl font-bold px-3 py-1 rounded-lg"
                style={{ background: projGradeColor!.bg, color: projGradeColor!.text }}
              >
                {projectedGrade}
              </span>
            </>
          ) : (
            <>
              <span className="text-sm" style={{ color: isIncomplete ? '#92400E' : '#78716C' }}>
                {scores.total_score.toFixed(1)}/{scores.max_possible.toFixed(0)}
                {isIncomplete && (
                  <span style={{ color: '#92400E' }}> · partial subtotal</span>
                )}
              </span>
              <span
                className="text-2xl font-bold px-3 py-1 rounded-lg"
                style={{ background: gradeColor.bg, color: gradeColor.text }}
                title={isIncomplete
                  ? 'Incomplete coverage — this grade is not comparable to a fully-scored protocol grade.'
                  : undefined}
                aria-label={isIncomplete
                  ? 'Grade incomplete: insufficient scoring for a complete protocol grade.'
                  : `Grade ${displayedGrade}`}
              >
                {displayedGrade}
              </span>
            </>
          )}
        </div>
        </div>
      </div>

      {/* INCOMPLETE caveat — required by the task: "partial subtotal not comparable complete grade" */}
      {isIncomplete && (
        <div
          className="p-3 rounded-lg text-xs"
          style={{ background: '#FAFAF8', border: '1px solid #D6D0C4', color: '#57534E' }}
          role="status"
        >
          <strong style={{ color: '#1C1917' }}>Grade is incomplete:</strong>{' '}
          only {assessedCount} of {totalPrinciples} principles could be scored.
          The {scores.total_score.toFixed(1)}/{scores.max_possible.toFixed(0)} subtotal is a partial
          score over assessed principles only and is{' '}
          <strong>not comparable to a complete protocol grade</strong>.
          {unavailableScores.length > 0 && (
            <> {unavailableScores.length} principle{unavailableScores.length === 1 ? '' : 's'} need additional data before a complete grade can be reported.</>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs" style={{ color: '#A8A29E' }}>
        <span>Lower = greener</span>
        <span>· No symbol = calculated</span>
        <span>· * = declared</span>
        <span>· ~ = benchmark-derived</span>
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

      {/* Summary footer — coverage breakdown distinguishes AI-assessed from deterministic */}
      <div className="flex flex-col sm:flex-row items-center justify-between text-[10px] sm:text-xs pt-4 mt-2 border-t gap-4" style={{ borderColor: '#D6D0C4', color: '#78716C' }}>
        <div className="text-center sm:text-left space-y-0.5">
          <div>
            {assessedCount} of {totalPrinciples} principles assessed
            {unavailableScores.length > 0 && (
              <span> · {unavailableScores.length} need additional data</span>
            )}
            {projectedScores && (
              <span> · Projected from accepted recommendations</span>
            )}
          </div>
          {(deterministicCount > 0 || aiAssessedCount > 0 || benchmarkCount > 0) && (
            <div style={{ color: '#A8A29E' }}>
              {deterministicCount > 0 && (
                <span>{deterministicCount} deterministic (calculated/declared)</span>
              )}
              {benchmarkCount > 0 && (
                <span>{deterministicCount > 0 ? ' · ' : ''}{benchmarkCount} benchmark-derived</span>
              )}
              {aiAssessedCount > 0 && (
                <span>{(deterministicCount > 0 || benchmarkCount > 0) ? ' · ' : ''}{aiAssessedCount} AI-assessed</span>
              )}
            </div>
          )}
        </div>
        {onRegrade && projectedScores && (
          <button
            onClick={onRegrade}
            disabled={isRegrading}
            className="text-[10px] sm:text-xs px-4 py-2 rounded border font-bold uppercase tracking-wider transition-colors disabled:opacity-50 w-full sm:w-auto"
            style={{ color: '#1C3822', borderColor: '#1C3822', background: 'white' }}
          >
            {isRegrading ? 'Re-grading...' : 'Re-grade with accepted changes'}
          </button>
        )}
      </div>
    </div>
  )
}
