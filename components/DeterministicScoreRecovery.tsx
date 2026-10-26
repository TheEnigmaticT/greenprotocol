'use client'

import { TalkAboutThis } from '@/components/TalkAboutThis'
import type { ProcedureProposal } from '@/lib/talk-about-this/procedure-proposal'
import type { HumanError } from '@/lib/errors/humanize'
import { buildScoringFailureRequest } from '@/lib/chemistry-unknowns'

export default function DeterministicScoreRecovery({
  onRetry,
  isRetrying,
  error,
  analysisId,
  onProcedureProposalApply,
}: {
  onRetry: () => void | Promise<void>
  isRetrying: boolean
  error: HumanError | null
  /** When set, the panel offers a chat about why there is no grade. */
  analysisId?: string
  onProcedureProposalApply?: (proposal: ProcedureProposal) => void | Promise<void>
}) {
  const issue = error ? 'rescore-failed' : 'scoring-unavailable'

  return (
    <section
      className="p-6 rounded-xl print:hidden"
      style={{ background: '#FEF2F2', border: '1px solid #FCA5A5' }}
      aria-labelledby="grade-unavailable-title"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h3 id="grade-unavailable-title" className="text-lg font-semibold font-[family-name:var(--font-serif)]" style={{ color: '#991B1B' }}>
            Grade unavailable
          </h3>
          <p className="text-sm mt-1" style={{ color: '#7F1D1D' }}>
            We couldn&apos;t calculate a grade because the reference data for this procedure wasn&apos;t available when it ran. Retrying usually fixes this.
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="shrink-0 min-h-[44px] px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
          style={{ background: '#1C3822', color: '#FAF8F3' }}
        >
          {isRetrying ? 'Retrying…' : 'Retry scoring'}
        </button>
      </div>
      {error && (
        <div role="alert" className="text-sm mt-3 space-y-1" style={{ color: '#991B1B' }}>
          <p className="font-semibold">{error.title}</p>
          <p>{error.message}</p>
        </div>
      )}
      {analysisId && (
        <div className="mt-3">
          <TalkAboutThis
            analysisId={analysisId}
            scope={{ kind: 'chemistry-clarification', issue, chemicals: [] }}
            title="why this analysis has no grade"
            evidenceState="sourced"
            buttonLabel="Chat about this"
            initialMessage={buildScoringFailureRequest(issue, error?.title)}
            onProcedureProposalApply={onProcedureProposalApply}
            className="min-h-[44px] px-4 py-2 rounded border text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            buttonStyle={{ color: '#1C3822', borderColor: '#1C3822', background: '#FAF8F3' }}
          />
        </div>
      )}
    </section>
  )
}
