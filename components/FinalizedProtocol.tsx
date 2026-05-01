'use client'

import { AnalysisResult, Recommendation } from '@/lib/types'
import { buildFinalizedProtocol } from '@/lib/finalized-protocol'
import PrincipleTag from './PrincipleTag'

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    high: { bg: '#FEE2E2', text: '#DC2626' },
    medium: { bg: '#FEF3C7', text: '#D97706' },
    low: { bg: '#DCFCE7', text: '#16a34a' },
  }
  const c = colors[severity] || colors.low
  return (
    <span
      className="px-2 py-0.5 rounded text-xs font-semibold uppercase"
      style={{ background: c.bg, color: c.text }}
    >
      {severity}
    </span>
  )
}

function PendingCard({ rec, onAccept, onDecline }: {
  rec: Recommendation
  onAccept: () => void
  onDecline: () => void
}) {
  return (
    <div className="p-4 rounded-lg border space-y-3" style={{ background: '#FAFAF8', borderColor: '#D6D0C4' }}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: '#1C1917' }}>Step {rec.stepNumber}</span>
          <SeverityBadge severity={rec.severity} />
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onAccept}
            className="text-xs px-3 py-1.5 rounded-full font-bold uppercase tracking-wider transition-colors border bg-white hover:border-[#16a34a] hover:text-[#16a34a]"
            style={{ color: '#78716C', borderColor: '#D6D0C4' }}
          >
            Accept
          </button>
          <button
            onClick={onDecline}
            className="text-xs px-3 py-1.5 rounded-full font-bold uppercase tracking-wider transition-colors border bg-white hover:border-[#DC2626] hover:text-[#DC2626]"
            style={{ color: '#78716C', borderColor: '#D6D0C4' }}
          >
            Decline
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {(Array.isArray(rec.principleNumbers) ? rec.principleNumbers : []).map((n) => (
          <PrincipleTag key={n} number={n} />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 rounded" style={{ background: '#FEF2F2' }}>
          <div className="text-xs font-semibold mb-1" style={{ color: '#DC2626' }}>ORIGINAL</div>
          <div className="text-sm font-[family-name:var(--font-mono)] font-semibold mb-1" style={{ color: '#1C1917' }}>
            {rec.original.chemical}
          </div>
          <p className="text-xs" style={{ color: '#78716C' }}>{rec.original.issue}</p>
        </div>
        <div className="p-3 rounded" style={{ background: '#F0FDF4' }}>
          <div className="text-xs font-semibold mb-1" style={{ color: '#16a34a' }}>RECOMMENDED</div>
          <div className="text-sm font-[family-name:var(--font-mono)] font-semibold mb-1" style={{ color: '#1C1917' }}>
            {rec.alternative.chemical}
          </div>
          <p className="text-xs" style={{ color: '#2D6A4F' }}>{rec.alternative.rationale}</p>
        </div>
      </div>
    </div>
  )
}

export default function FinalizedProtocol({
  analysis,
  originalProtocol,
  onUpdateAnalysis,
}: {
  analysis: AnalysisResult
  originalProtocol?: string
  onUpdateAnalysis?: (updated: AnalysisResult) => void
}) {
  const total = analysis.recommendations.length
  const accepted = analysis.recommendations.filter(r => r.isAccepted === true)
  const declined = analysis.recommendations.filter(r => r.isAccepted === false)
  const pending = analysis.recommendations.filter(r => r.isAccepted === undefined || r.isAccepted === null)
  const reviewed = accepted.length + declined.length
  const shouldShowFinalizedProtocol = reviewed > 0 || total === 0
  const finalizedProtocol = buildFinalizedProtocol(analysis, originalProtocol)
  const procedureTitle = pending.length > 0 ? 'Current Lab Procedure Draft' : 'Finished Lab Procedure'

  const setRecAccepted = (index: number, value: boolean) => {
    if (!onUpdateAnalysis) return
    const newRecs = [...analysis.recommendations]
    newRecs[index] = { ...newRecs[index], isAccepted: value }
    onUpdateAnalysis({ ...analysis, recommendations: newRecs })
  }

  const toggleAccepted = (index: number) => {
    if (!onUpdateAnalysis) return
    const newRecs = [...analysis.recommendations]
    newRecs[index] = { ...newRecs[index], isAccepted: !newRecs[index].isAccepted }
    onUpdateAnalysis({ ...analysis, recommendations: newRecs })
  }

  const toggleDeclined = (index: number) => {
    if (!onUpdateAnalysis) return
    const newRecs = [...analysis.recommendations]
    const current = newRecs[index].isAccepted
    // If already declined (false), set to undefined (pending). If not declined, set to false.
    newRecs[index] = { ...newRecs[index], isAccepted: current === false ? undefined : false }
    onUpdateAnalysis({ ...analysis, recommendations: newRecs })
  }

  return (
    <div>
      {/* Print-only header */}
      <div className="hidden print:block mb-6 pb-4" style={{ borderBottom: '1px solid #D6D0C4' }}>
        <p className="text-xs font-[family-name:var(--font-mono)]" style={{ color: '#78716C' }}>
          greenchemistry.ai — {analysis.protocolTitle} —{' '}
          {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h2 className="text-xl font-bold font-[family-name:var(--font-serif)]" style={{ color: '#1C1917' }}>
            Recommendations ({total})
          </h2>
          {(accepted.length > 0 || declined.length > 0) && (
            <p className="text-sm mt-1" style={{ color: '#78716C' }}>
              {accepted.length} accepted · {declined.length} declined
              {pending.length > 0 && ` · ${pending.length} pending`}
            </p>
          )}
        </div>
        {accepted.length > 0 && (
          <button
            onClick={() => window.print()}
            className="print:hidden text-xs px-4 py-2 rounded border flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
            style={{ color: '#1B4332', borderColor: '#D6D0C4', background: 'white' }}
          >
            Print Lab Manual
          </button>
        )}
      </div>

      <div className="space-y-6">
        {/* Pending recommendations — need review */}
        {pending.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: '#D97706' }}>
              Pending Review ({pending.length})
            </h3>
            <div className="space-y-3">
              {pending.map((rec) => {
                const globalIndex = analysis.recommendations.indexOf(rec)
                return (
                  <PendingCard
                    key={globalIndex}
                    rec={rec}
                    onAccept={() => setRecAccepted(globalIndex, true)}
                    onDecline={() => setRecAccepted(globalIndex, false)}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* Accepted changes */}
        {accepted.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: '#16a34a' }}>
              Accepted Changes ({accepted.length})
            </h3>
            <div className="space-y-2">
              {accepted.map((rec) => {
                const globalIndex = analysis.recommendations.indexOf(rec)
                return (
                  <div
                    key={globalIndex}
                    className="flex gap-3 items-start p-3 rounded-lg text-sm cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}
                    onClick={() => toggleAccepted(globalIndex)}
                  >
                    <span className="font-semibold shrink-0 mt-0.5" style={{ color: '#78716C' }}>
                      Step {rec.stepNumber}
                    </span>
                    <div className="flex-1">
                      <span className="font-[family-name:var(--font-mono)]" style={{ color: '#DC2626' }}>
                        {rec.original.chemical}
                      </span>
                      <span style={{ color: '#78716C' }}> → </span>
                      <span className="font-[family-name:var(--font-mono)]" style={{ color: '#16a34a' }}>
                        {rec.alternative.chemical}
                      </span>
                    </div>
                    <span className="text-xs shrink-0" style={{ color: '#16a34a' }}>✓</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Declined changes */}
        {declined.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: '#78716C' }}>
              Declined ({declined.length})
            </h3>
            <div className="space-y-2">
              {declined.map((rec) => {
                const globalIndex = analysis.recommendations.indexOf(rec)
                return (
                  <div
                    key={globalIndex}
                    className="flex gap-3 items-center p-3 rounded-lg text-sm cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ background: '#F5F5F4', border: '1px solid #D6D0C4' }}
                    onClick={() => toggleDeclined(globalIndex)}
                  >
                    <span className="font-semibold shrink-0" style={{ color: '#78716C' }}>
                      Step {rec.stepNumber}
                    </span>
                    <span className="font-[family-name:var(--font-mono)] flex-1" style={{ color: '#A8A29E' }}>
                      {rec.original.chemical}
                    </span>
                    <span className="text-xs shrink-0" style={{ color: '#A8A29E' }}>✗</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Finalized protocol text — reflects accepted changes and keeps declined items unchanged */}
        {shouldShowFinalizedProtocol && (
          <div>
            <h3 className="text-sm font-semibold mb-2" style={{ color: '#1B4332' }}>{procedureTitle}</h3>
            {pending.length > 0 && (
              <p
                className="text-xs p-3 rounded mb-3"
                style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}
              >
                This draft reflects accepted changes only. Pending and declined recommendations remain as written in the original procedure.
              </p>
            )}
            <pre
              className="p-4 rounded-lg text-sm whitespace-pre-wrap font-[family-name:var(--font-mono)] leading-relaxed"
              style={{ background: '#F0FDF4', color: '#1C1917', border: '1px solid #BBF7D0' }}
            >
              {finalizedProtocol}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
