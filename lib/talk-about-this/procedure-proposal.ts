/**
 * A model-proposed edit to the saved procedure, computed and stored by the server.
 * `diff` is display text; `proposedText` is what a re-run would analyse. Nothing in a
 * proposal changes the saved analysis.
 */
export interface ProcedureProposal {
  proposalId: string
  summary: string
  /** Unified-style text: `@@` hunks, lines prefixed by a space, `-` or `+`. */
  diff: string
  proposedText: string
  baseRevisionNumber: number
}

export function parseProcedureProposal(value: unknown): ProcedureProposal | null {
  if (!value || typeof value !== 'object') return null
  const { proposalId, summary, diff, proposedText, baseRevisionNumber } = value as Record<string, unknown>
  if (
    typeof proposalId !== 'string'
    || !proposalId.trim()
    || typeof summary !== 'string'
    || !summary.trim()
    || typeof diff !== 'string'
    || !diff.trim()
    || typeof proposedText !== 'string'
    || !proposedText.trim()
    || typeof baseRevisionNumber !== 'number'
    || !Number.isSafeInteger(baseRevisionNumber)
    || baseRevisionNumber < 1
  ) return null

  return { proposalId, summary, diff, proposedText, baseRevisionNumber }
}
