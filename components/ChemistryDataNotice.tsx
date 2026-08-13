import { ChemistryDataStatus } from '@/lib/types'

export default function ChemistryDataNotice({ status }: { status?: ChemistryDataStatus }) {
  if (!status?.pending) return null

  // Two honest states, escalating. When deterministic scoring never ran at all,
  // that's the more serious disclosure (scores are LLM-only) and gets a stronger
  // treatment than a few missing reference records. The copy is owned by the
  // pipeline (status.message) so the UI can't drift back to a false "all available".
  const scoringUnavailable = status.deterministicScoringAvailable === false

  const shown = status.unresolvedChemicals.slice(0, 6)
  const remaining = status.unresolvedChemicals.length - shown.length

  const palette = scoringUnavailable
    ? { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', body: '#7F1D1D' }
    : { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#9A3412', body: '#7C2D12' }

  return (
    <div
      className="print:hidden p-4 rounded-lg text-sm"
      style={{ background: palette.background, border: palette.border, color: palette.color }}
    >
      <p className="font-semibold">
        {scoringUnavailable ? 'Deterministic scoring unavailable' : 'Reference data missing'}
      </p>
      <p className="mt-1" style={{ color: palette.body }}>
        {status.message}
      </p>
      {shown.length > 0 && (
        <p className="mt-2 font-[family-name:var(--font-mono)] text-xs">
          {scoringUnavailable ? 'Affected chemicals' : 'Missing reference records'}: {shown.join(', ')}{remaining > 0 ? `, +${remaining} more` : ''}
        </p>
      )}
    </div>
  )
}
