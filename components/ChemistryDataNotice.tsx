import { ChemistryDataStatus } from '@/lib/types'

function formatMaterials(materials: string[]) {
  if (materials.length === 1) return materials[0]
  if (materials.length === 2) return `${materials[0]} and ${materials[1]}`
  return `${materials.slice(0, -1).join(', ')}, and ${materials.at(-1)}`
}

function unknownNames(status: ChemistryDataStatus): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const name of [...(status.indefiniteChemicals ?? []), ...(status.unresolvedChemicals ?? [])]) {
    const trimmed = name.trim()
    const key = trimmed.toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    names.push(trimmed)
  }
  return names
}

export default function ChemistryDataNotice({ status }: { status?: ChemistryDataStatus }) {
  if (!status) return null
  const unknown = unknownNames(status)
  if (!status.pending && unknown.length === 0) return null

  const scoringUnavailable = status.deterministicScoringAvailable === false
  const callOutUnknown = !scoringUnavailable && unknown.length > 0
  const unresolved = (status.unresolvedChemicals ?? []).filter(name => name.trim())
  const indefiniteOnly = callOutUnknown && unresolved.length === 0
  const label = formatMaterials(unknown)
  const verb = unknown.length === 1 ? 'is' : 'are'
  const bodyCopy = indefiniteOnly
    ? 'We cannot treat mixtures or undefined compositions as a single chemical, so scoring skipped them. Your score may go up or down substantially if you specify them more precisely and rerun.'
    : 'We scored everything we could identify. Check the spelling, or name it more precisely, and rerun. Your score may go up or down substantially.'

  const palette = scoringUnavailable
    ? { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', body: '#7F1D1D' }
    : { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#9A3412', body: '#7C2D12' }

  return (
    <div
      className="print:hidden p-4 rounded-lg text-sm"
      style={{ background: palette.background, border: palette.border, color: palette.color }}
    >
      {callOutUnknown ? (
        <>
          <p className="font-semibold">We don&apos;t know what {label} {verb}!</p>
          <p className="mt-1" style={{ color: palette.body }}>
            {bodyCopy}
          </p>
        </>
      ) : (
        <>
          <p className="font-semibold">Deterministic scoring unavailable</p>
          <p className="mt-1" style={{ color: palette.body }}>
            {status.message}
          </p>
        </>
      )}
    </div>
  )
}
