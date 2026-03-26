'use client'

import { useEffect } from 'react'
import { AnalysisResult } from '@/lib/types'

export default function FinalizedProtocol({ analysis }: { analysis: AnalysisResult }) {
  useEffect(() => {
    if (sessionStorage.getItem('gpc_print_pending') === '1') {
      sessionStorage.removeItem('gpc_print_pending')
      setTimeout(() => window.print(), 150)
    }
  }, [])
  const accepted = analysis.recommendations.filter(r => r.isAccepted === true)
  const declined = analysis.recommendations.filter(r => r.isAccepted === false)
  const pending = analysis.recommendations.filter(r => r.isAccepted === undefined || r.isAccepted === null)
  const total = analysis.recommendations.length
  const hasReviewed = accepted.length > 0 || declined.length > 0

  return (
    <div>
      {/* Print-only header */}
      <div className="hidden print:block mb-6 pb-4" style={{ borderBottom: '1px solid #D6D0C4' }}>
        <p className="text-xs font-[family-name:var(--font-mono)]" style={{ color: '#78716C' }}>
          greenchemistry.ai — {analysis.protocolTitle} —{' '}
          {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold font-[family-name:var(--font-serif)]" style={{ color: '#1C1917' }}>
            Finalized Protocol
          </h2>
          {hasReviewed && (
            <p className="text-sm mt-1" style={{ color: '#78716C' }}>
              {accepted.length} of {total} changes accepted
              {pending.length > 0 && ` · ${pending.length} not yet reviewed`}
            </p>
          )}
        </div>
        {hasReviewed && (
          <button
            onClick={() => {
            sessionStorage.setItem('gpc_print_pending', '1')
            window.location.reload()
          }}
            className="print:hidden text-xs px-4 py-2 rounded border flex items-center gap-2 transition-colors"
            style={{ color: '#1B4332', borderColor: '#D6D0C4', background: 'white' }}
          >
            Print Lab Manual
          </button>
        )}
      </div>

      {!hasReviewed ? (
        <div className="p-8 rounded-lg text-center" style={{ background: '#F5F0E8', border: '1px solid #D6D0C4' }}>
          <p className="text-sm" style={{ color: '#78716C' }}>
            Accept or decline the recommendations above to build your finalized protocol.
          </p>
          <p className="text-xs mt-2" style={{ color: '#A8A29E' }}>
            Your choices are saved automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Accepted changes */}
          {accepted.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3" style={{ color: '#16a34a' }}>
                Accepted Changes ({accepted.length})
              </h3>
              <div className="space-y-2">
                {accepted.map((rec, i) => (
                  <div
                    key={i}
                    className="flex gap-3 items-start p-3 rounded-lg text-sm"
                    style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}
                  >
                    <span className="font-semibold shrink-0 mt-0.5" style={{ color: '#78716C' }}>
                      Step {rec.stepNumber}
                    </span>
                    <div>
                      <span className="font-[family-name:var(--font-mono)]" style={{ color: '#DC2626' }}>
                        {rec.original.chemical}
                      </span>
                      <span style={{ color: '#78716C' }}> → </span>
                      <span className="font-[family-name:var(--font-mono)]" style={{ color: '#16a34a' }}>
                        {rec.alternative.chemical}
                      </span>
                      {rec.alternative.yieldImpact && (
                        <p className="text-xs mt-0.5" style={{ color: '#78716C' }}>
                          {rec.alternative.yieldImpact}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Declined changes */}
          {declined.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3" style={{ color: '#78716C' }}>
                Original Steps Retained ({declined.length})
              </h3>
              <div className="space-y-2">
                {declined.map((rec, i) => (
                  <div
                    key={i}
                    className="flex gap-3 items-center p-3 rounded-lg text-sm"
                    style={{ background: '#F5F5F4', border: '1px solid #D6D0C4' }}
                  >
                    <span className="font-semibold shrink-0" style={{ color: '#78716C' }}>
                      Step {rec.stepNumber}
                    </span>
                    <span className="font-[family-name:var(--font-mono)]" style={{ color: '#A8A29E' }}>
                      {rec.original.chemical}
                    </span>
                    <span className="text-xs" style={{ color: '#A8A29E' }}>
                      (original retained)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pending.length > 0 && (
            <p className="text-xs" style={{ color: '#A8A29E' }}>
              {pending.length} recommendation{pending.length !== 1 ? 's' : ''} not yet reviewed.
            </p>
          )}

          {/* Revised protocol text */}
          <div>
            <h3 className="text-sm font-semibold mb-2" style={{ color: '#1B4332' }}>Revised Protocol Text</h3>
            {declined.length > 0 && (
              <p
                className="text-xs mb-3 p-3 rounded"
                style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}
              >
                This text incorporates all AI recommendations. Manually revert{' '}
                Step{declined.length !== 1 ? 's' : ''} {declined.map(r => r.stepNumber).join(', ')} to restore
                the original chemicals you chose to retain.
              </p>
            )}
            <pre
              className="p-4 rounded-lg text-sm whitespace-pre-wrap font-[family-name:var(--font-mono)] leading-relaxed"
              style={{ background: '#F0FDF4', color: '#1C1917', border: '1px solid #BBF7D0' }}
            >
              {analysis.revisedProtocol}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
