import { ChemistryDataStatus } from '@/lib/types'
import { TalkAboutThis } from '@/components/TalkAboutThis'
import type { ProcedureProposal } from '@/lib/talk-about-this/procedure-proposal'
import { buildChemistryStatusMessage } from '@/lib/chemistry-status-message'
import {
  buildClarificationRequest,
  clarificationChemicals,
  countUnknownMaterials,
  describeMaterial,
  groupUnknownMaterials,
  unknownGroupCopy,
} from '@/lib/chemistry-unknowns'

export default function ChemistryDataNotice({ status, analysisId, onProcedureProposalApply }: {
  status?: ChemistryDataStatus
  analysisId?: string
  /** Re-runs an edited procedure the scientist applied from the chat as a new analysis. */
  onProcedureProposalApply?: (proposal: ProcedureProposal) => void | Promise<void>
}) {
  if (!status) return null
  const groups = groupUnknownMaterials(status)
  if (!status.pending && groups.length === 0) return null

  const scoringUnavailable = status.deterministicScoringAvailable === false
  const callOutUnknown = !scoringUnavailable && groups.length > 0
  const unknownCount = countUnknownMaterials(groups)

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
          <p className="font-semibold">
            {unknownCount === 1 ? "1 material couldn't be fully scored" : `${unknownCount} materials couldn't be fully scored`}
          </p>
          {groups.map(group => {
            const copy = unknownGroupCopy(group.reason, group.materials.length > 1)
            return (
              <div key={group.reason} className="mt-3" style={{ color: palette.body }}>
                <p>{copy.lead}</p>
                <ul className="mt-1 list-disc pl-5 font-[family-name:var(--font-mono)] text-[13px]">
                  {group.materials.map(material => (
                    <li key={material.name}>{describeMaterial(material)}</li>
                  ))}
                </ul>
                <p className="mt-1">{copy.consequence}</p>
                <p className="mt-1 font-semibold">What to do: <span className="font-normal">{copy.action}</span></p>
              </div>
            )
          })}
          {analysisId && (
            <div className="mt-3">
              <TalkAboutThis
                analysisId={analysisId}
                scope={{ kind: 'chemistry-clarification', issue: 'unresolved-compound', chemicals: clarificationChemicals(groups) }}
                title="materials we couldn't fully score"
                evidenceState="sourced"
                buttonLabel="Chat about this"
                initialMessage={buildClarificationRequest(groups)}
                onProcedureProposalApply={onProcedureProposalApply}
                className="min-h-[44px] px-4 py-2 rounded border text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                buttonStyle={{ color: '#1C3822', borderColor: '#1C3822', background: '#FAF8F3' }}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <p className="font-semibold">We couldn&apos;t score this analysis against reference data</p>
          <p className="mt-1" style={{ color: palette.body }}>
            {buildChemistryStatusMessage({ scoringAvailable: false, unresolvedCount: 0, indefiniteCount: 0 })}
          </p>
        </>
      )}
    </div>
  )
}
