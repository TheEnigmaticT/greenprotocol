import { getScoringViewStatus } from '@/lib/scoring-view-status'

export default function ScoringAuditNotice({ analysis }: { analysis: unknown }) {
  const status = getScoringViewStatus(analysis)
  if (status.kind === 'no-original-record' || status.kind === 'matches-original') return null
  return (
    <aside role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <strong>{status.kind === 'comparison-unavailable' ? 'Original score comparison unavailable.' : 'Edited view, not original score replay.'}</strong>{' '}
      The current scores and inputs are not verified by the preserved original scoring record.
      Stored-result replay returns the original scores, not this edited view. Run a fresh analysis to create a new auditable record.
    </aside>
  )
}
