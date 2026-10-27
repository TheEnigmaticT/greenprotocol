import type { SciSureWorkspace, SciSureWorkspaceFinding } from './workspace-contract'

/** Server DTO from GET /api/integrations/scisure/analyses/[id]/workspace. */
export type SavedSciSureWorkspace = Omit<SciSureWorkspace, 'analysis'> & { analysis: NonNullable<SciSureWorkspace['analysis']> }

export type SavedWorkspaceLoad =
  | { kind: 'ready'; workspace: SavedSciSureWorkspace }
  | { kind: 'signin' }
  | { kind: 'unavailable' }
  | { kind: 'error' }

/** 401 and 404 are distinct, expected outcomes; anything else is a transient failure, not absence. */
export async function classifyWorkspaceResponse(response: { status: number; ok: boolean; json: () => Promise<unknown> }): Promise<SavedWorkspaceLoad> {
  if (response.status === 401) return { kind: 'signin' }
  if (response.status === 404) return { kind: 'unavailable' }
  if (!response.ok) return { kind: 'error' }
  try {
    const body = await response.json() as Partial<SavedSciSureWorkspace> | null
    if (!body || body.version !== 2 || !body.analysis || !Array.isArray(body.findings) || typeof body.retentionExpiresAt !== 'string') return { kind: 'error' }
    return { kind: 'ready', workspace: body as SavedSciSureWorkspace }
  } catch {
    return { kind: 'error' }
  }
}

export function decisionLabel(finding: Pick<SciSureWorkspaceFinding, 'decision'>): string {
  if (finding.decision === 'accepted') return 'Accepted'
  if (finding.decision === 'rejected') return 'Rejected'
  return 'Not reviewed'
}

export function findingKindLabel(finding: SciSureWorkspaceFinding): string {
  if (finding.recommendation.cardKind === 'warning') return 'Hazard warning'
  return finding.applicable ? 'Substitution' : 'Hypothesis, not application-eligible'
}

/** Accepting is a review decision; only an application-eligible swap can ever change procedure text. */
export function findingEffectNote(finding: SciSureWorkspaceFinding): string {
  if (!finding.applicable) return 'Acknowledging this finding never changes the procedure.'
  if (finding.decision === 'accepted') return 'Accepted as an application-eligible change.'
  if (finding.decision === 'rejected') return 'Rejected; the procedure stays as written.'
  return 'Awaiting a decision in the SciSure review popup.'
}

export function reviewProgress(findings: readonly Pick<SciSureWorkspaceFinding, 'decision'>[]): { reviewed: number; total: number } {
  return { reviewed: findings.filter(finding => finding.decision !== null).length, total: findings.length }
}

/** UTC calendar date, so the label does not shift with the reader's locale or time zone. */
export function retentionLabel(retentionExpiresAt: string): string {
  const time = Date.parse(retentionExpiresAt)
  return Number.isFinite(time) ? `Retained until ${new Date(time).toISOString().slice(0, 10)} (UTC)` : 'Retention date unavailable'
}

/** A hazard warning carries the same material on both sides; an arrow to itself reads as a substitution that does not exist. */
export function replacementChemical(finding: Pick<SciSureWorkspaceFinding, 'recommendation'>): string | null {
  const { original, alternative } = finding.recommendation
  const replacement = alternative.chemical.trim()
  return replacement && replacement.toLowerCase() !== original.chemical.trim().toLowerCase() ? replacement : null
}

/** Models often repeat the issue as the rationale; show a sentence once. */
export function distinctRationale(finding: Pick<SciSureWorkspaceFinding, 'recommendation'>): string | null {
  const { original, alternative } = finding.recommendation
  const rationale = alternative.rationale.trim()
  return rationale && rationale !== original.issue.trim() ? rationale : null
}
