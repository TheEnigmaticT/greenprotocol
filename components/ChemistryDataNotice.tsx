import { ChemistryDataStatus } from '@/lib/types'

function formatMaterials(materials: string[]) {
  if (materials.length === 1) return materials[0]
  if (materials.length === 2) return `${materials[0]} and ${materials[1]}`
  return `${materials.slice(0, -1).join(', ')}, and ${materials.at(-1)}`
}

export default function ChemistryDataNotice({ status }: { status?: ChemistryDataStatus }) {
  if (!status?.pending && !status?.indefiniteChemicals?.length) return null

  const scoringUnavailable = status.deterministicScoringAvailable === false
  const indefinite = status.indefiniteChemicals ?? []
  const hasPartialIndefiniteData = !scoringUnavailable && indefinite.length > 0
  const indefiniteLabel = formatMaterials(indefinite)
  const indefiniteVerb = indefinite.length === 1 ? 'is' : 'are'

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
      {hasPartialIndefiniteData ? (
        <>
          <p className="font-semibold">We don&apos;t know what {indefiniteLabel} {indefiniteVerb}!</p>
          <p className="mt-1" style={{ color: palette.body }}>
            We scored everything we could, but materials with an indefinite composition can&apos;t be analyzed. This analysis is based on everything whose chemical composition we could determine. Your score may go up or down substantially if you specify {indefiniteLabel} more precisely and rerun this analysis.
          </p>
        </>
      ) : (
        <>
          <p className="font-semibold">
            {scoringUnavailable ? 'Deterministic scoring unavailable' : 'Reference data missing'}
          </p>
          <p className="mt-1" style={{ color: palette.body }}>
            {status.message}
          </p>
        </>
      )}
      {shown.length > 0 && (
        <p className="mt-2 font-[family-name:var(--font-mono)] text-xs">
          {scoringUnavailable ? 'Affected chemicals' : 'Missing reference records'}: {shown.join(', ')}{remaining > 0 ? `, +${remaining} more` : ''}
        </p>
      )}
    </div>
  )
}
