import { ChemistryDataStatus } from '@/lib/types'

export default function ChemistryDataNotice({ status }: { status?: ChemistryDataStatus }) {
  if (!status?.pending) return null

  const shown = status.unresolvedChemicals.slice(0, 6)
  const remaining = status.unresolvedChemicals.length - shown.length
  const message = 'We could not retrieve every chemical reference record live. This analysis used the best data available, and queued the missing items so the analysis can be re-run when updated reference data is available.'

  return (
    <div
      className="print:hidden p-4 rounded-lg text-sm"
      style={{ background: '#FFF7ED', border: '1px solid #FDBA74', color: '#9A3412' }}
    >
      <p className="font-semibold">Reference data missing</p>
      <p className="mt-1" style={{ color: '#7C2D12' }}>
        {message}
      </p>
      {shown.length > 0 && (
        <p className="mt-2 font-[family-name:var(--font-mono)] text-xs">
          Missing reference records: {shown.join(', ')}{remaining > 0 ? `, +${remaining} more` : ''}
        </p>
      )}
    </div>
  )
}
