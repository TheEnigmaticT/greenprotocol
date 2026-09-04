'use client'

import { AnalysisResult, Recommendation } from '@/lib/types'
import { RecommendationApprovalReceipt, TalkAboutThis } from './TalkAboutThis'
import { buildFinalizedProtocol } from '@/lib/finalized-protocol'

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    high: { bg: '#FEE2E2', text: '#DC2626' },
    medium: { bg: '#FEF3C7', text: '#D97706' },
    low: { bg: '#DCFCE7', text: '#16a34a' },
  }
  const c = colors[severity] || colors.low
  return (
    <span
      className="px-1.5 py-0.5 rounded-sm text-xs font-bold uppercase tracking-wider font-[family-name:var(--font-mono)]"
      style={{ background: c.bg, color: c.text, letterSpacing: '0.08em' }}
    >
      {severity}
    </span>
  )
}

function evidenceLabel(rec: Recommendation): 'Sourced' | 'Inferred' {
  if (rec.evidenceTier === 'sourced') return 'Sourced'
  if (rec.evidenceTier === 'inferred') return 'Inferred'
  return (rec.evidence?.citations.length ?? 0) > 0 ? 'Sourced' : 'Inferred'
}

function PendingCard({ rec, onAccept, onDecline, onRecommendationApproved, analysisId, recommendationIndex }: {
  rec: Recommendation
  onAccept: () => void
  onDecline: () => void
  onRecommendationApproved?: (receipt: RecommendationApprovalReceipt) => void
  analysisId?: string
  recommendationIndex: number
}) {
  const tier = evidenceLabel(rec)
  const evidenceState = tier === 'Sourced' ? 'sourced' : 'inferred'

  return (
    <article
      className="p-4 sm:p-5 rounded-lg border flex flex-col min-w-0"
      style={{ background: '#FAFAF8', borderColor: '#D6D0C4' }}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span
          className="text-xs font-bold uppercase tracking-wider font-[family-name:var(--font-mono)]"
          style={{ color: '#1C1917', letterSpacing: '0.08em' }}
        >
          Step {rec.stepNumber}
        </span>
        <SeverityBadge severity={rec.severity} />
      </div>

      <p
        className="m-0 mb-2.5 font-[family-name:var(--font-serif)] font-bold text-[19px] sm:text-[22px] leading-snug"
        style={{ color: '#0D1F16' }}
      >
        Replace{' '}
        <span className="font-[family-name:var(--font-mono)] font-medium text-[16px] sm:text-[16px] tabular-nums">
          {rec.original.chemical}
        </span>{' '}
        with{' '}
        <span className="font-[family-name:var(--font-mono)] font-medium text-[16px] tabular-nums">
          {rec.alternative.chemical}
        </span>
        .
      </p>

      <p
        className="m-0 mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-[family-name:var(--font-mono)] text-[15px] sm:text-base font-medium leading-snug tabular-nums"
      >
        <span style={{ color: '#DC2626' }}>{rec.original.chemical}</span>
        <span style={{ color: '#44403C', fontWeight: 400 }}>→</span>
        <span style={{ color: '#006D15' }}>{rec.alternative.chemical}</span>
      </p>

      <p
        className="m-0 mb-4 font-[family-name:var(--font-sans)] text-base leading-relaxed"
        style={{ color: '#1C1917', maxWidth: '62em' }}
      >
        {rec.alternative.rationale}
      </p>

      <p
        className="m-0 mb-3 font-[family-name:var(--font-mono)] text-[11px] font-medium uppercase tracking-[0.12em]"
        style={{ color: '#A8A29E' }}
      >
        {tier}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-auto">
        <button
          type="button"
          onClick={onAccept}
          className="inline-flex items-center justify-center min-h-11 px-3 font-[family-name:var(--font-mono)] text-xs font-bold uppercase tracking-[0.14em] cursor-pointer"
          style={{ background: '#1C3822', color: '#F6F3EB', border: '1px solid #1C3822' }}
        >
          Accept
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="inline-flex items-center justify-center min-h-11 px-3 font-[family-name:var(--font-mono)] text-xs font-bold uppercase tracking-[0.14em] cursor-pointer"
          style={{ background: '#FAFAF8', color: '#78716C', border: '1px solid #D6D0C4' }}
        >
          Reject
        </button>
        <TalkAboutThis
          analysisId={analysisId}
          scope={rec.id
            ? { kind: 'recommendation', recommendationId: rec.id }
            : { kind: 'recommendation', recommendationIndex }}
          title={`Step ${rec.stepNumber}: ${rec.original.chemical} → ${rec.alternative.chemical}`}
          evidenceState={evidenceState}
          onRecommendationApproved={onRecommendationApproved}
          buttonLabel="Ask"
          className="inline-flex items-center justify-center min-h-11 w-full px-3 font-[family-name:var(--font-mono)] text-xs font-bold uppercase tracking-[0.14em]"
          buttonStyle={{ background: '#F6F3EB', color: '#1C3822', border: '1px solid #ECB815', borderRadius: 0 }}
        />
      </div>
    </article>
  )
}

export default function FinalizedProtocol({
  analysis,
  originalProtocol,
  onUpdateAnalysis,
  onRecommendationApproved,
  analysisId,
}: {
  analysis: AnalysisResult
  originalProtocol?: string
  onUpdateAnalysis?: (updated: AnalysisResult) => void
  onRecommendationApproved?: (receipt: RecommendationApprovalReceipt) => void
  analysisId?: string
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
    newRecs[index] = { ...newRecs[index], isAccepted: current === false ? undefined : false }
    onUpdateAnalysis({ ...analysis, recommendations: newRecs })
  }

  return (
    <div>
      <div className="hidden print:block mb-6 pb-4" style={{ borderBottom: '1px solid #D6D0C4' }}>
        <p className="text-xs font-[family-name:var(--font-mono)]" style={{ color: '#78716C' }}>
          greenchemistry.ai — {analysis.protocolTitle} —{' '}
          {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      <div className="space-y-8">
        {pending.length > 0 && (
          <section>
            <p
              className="m-0 mb-3 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.2em]"
              style={{ color: '#9D8026' }}
            >
              Pending review · {pending.length}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 min-[1600px]:grid-cols-3 gap-4 md:gap-5">
              {pending.map((rec) => {
                const globalIndex = analysis.recommendations.indexOf(rec)
                return (
                  <PendingCard
                    key={globalIndex}
                    rec={rec}
                    onAccept={() => setRecAccepted(globalIndex, true)}
                    onDecline={() => setRecAccepted(globalIndex, false)}
                    onRecommendationApproved={onRecommendationApproved}
                    analysisId={analysisId}
                    recommendationIndex={globalIndex}
                  />
                )
              })}
            </div>
          </section>
        )}

        {accepted.length > 0 && (
          <section>
            <p
              className="m-0 mb-3 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.2em]"
              style={{ color: '#9D8026' }}
            >
              Accepted · {accepted.length}
            </p>
            <div className="space-y-3">
              {accepted.map((rec) => {
                const globalIndex = analysis.recommendations.indexOf(rec)
                return (
                  <div key={globalIndex}>
                    <div
                      className="flex flex-wrap items-baseline gap-x-4 gap-y-2 px-4 py-3 rounded-lg cursor-pointer"
                      style={{ background: '#F5F0E8', border: '1px solid #D6D0C4', color: '#78716C' }}
                      onClick={() => toggleAccepted(globalIndex)}
                    >
                      <span className="text-xs font-bold uppercase tracking-wider font-[family-name:var(--font-mono)]" style={{ color: '#1C1917' }}>
                        Step {rec.stepNumber}
                      </span>
                      <p className="m-0 flex flex-wrap items-baseline gap-x-3 font-[family-name:var(--font-mono)] text-sm font-medium">
                        <span style={{ color: '#A8A29E', textDecoration: 'line-through' }}>{rec.original.chemical}</span>
                        <span>→</span>
                        <span style={{ color: '#006D15' }}>{rec.alternative.chemical}</span>
                      </p>
                      {rec.id && (
                        <div className="shrink-0" onClick={event => event.stopPropagation()}>
                          <TalkAboutThis
                            analysisId={analysisId}
                            scope={{ kind: 'recommendation', recommendationId: rec.id }}
                            title={`Step ${rec.stepNumber}: ${rec.original.chemical} → ${rec.alternative.chemical}`}
                            evidenceState={rec.evidenceTier ?? ((rec.evidence?.citations.length ?? 0) > 0 ? 'sourced' : 'inferred')}
                            onRecommendationApproved={onRecommendationApproved}
                            buttonLabel="Talk about this"
                          />
                        </div>
                      )}
                      <span
                        className="ml-auto font-[family-name:var(--font-mono)] text-xs font-bold uppercase tracking-[0.16em]"
                        style={{ color: '#006D15' }}
                      >
                        Accepted
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {declined.length > 0 && (
          <section>
            <p
              className="m-0 mb-3 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.2em]"
              style={{ color: '#9D8026' }}
            >
              Rejected · {declined.length}
            </p>
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
                    <span className="font-semibold shrink-0 font-[family-name:var(--font-mono)] text-xs uppercase" style={{ color: '#78716C' }}>
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
          </section>
        )}

        {shouldShowFinalizedProtocol && (
          <section
            className="reward"
            style={{
              marginTop: 4,
              padding: '14px 16px 14px 18px',
              borderLeft: '3px solid #ECB815',
              background: '#FAFAF8',
              borderTop: '1px solid #D6D0C4',
              borderRight: '1px solid #D6D0C4',
              borderBottom: '1px solid #D6D0C4',
            }}
          >
            <h3 className="text-sm font-semibold mb-2 font-[family-name:var(--font-serif)]" style={{ color: '#1C3822' }}>
              {procedureTitle}
            </h3>
            {pending.length > 0 && (
              <p className="text-sm mb-3 font-[family-name:var(--font-sans)]" style={{ color: '#1C1917' }}>
                Draft reflects accepted changes only. Pending items remain as written.
              </p>
            )}
            {accepted.length > 0 && (
              <button
                onClick={() => window.print()}
                className="print:hidden text-xs px-4 py-2 mb-3 rounded border transition-colors"
                style={{ color: '#1C3822', borderColor: '#D6D0C4', background: 'white' }}
              >
                Print Lab Manual
              </button>
            )}
            <pre
              className="m-0 text-sm whitespace-pre-wrap font-[family-name:var(--font-mono)] leading-relaxed"
              style={{ color: '#1C1917' }}
            >
              {finalizedProtocol}
            </pre>
          </section>
        )}

        {total === 0 && (
          <p className="text-sm" style={{ color: '#78716C' }}>No recommendations for this protocol.</p>
        )}
      </div>
    </div>
  )
}
