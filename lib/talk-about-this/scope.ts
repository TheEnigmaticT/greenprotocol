export const CLARIFICATION_ISSUES = ['unresolved-compound', 'scoring-unavailable', 'rescore-failed'] as const
export type ClarificationIssue = (typeof CLARIFICATION_ISSUES)[number]

export const MAX_CLARIFICATION_CHEMICALS = 10
export const MAX_CLARIFICATION_CHEMICAL_CHARS = 120

export type TalkAboutScope =
  | { kind: 'recommendation'; recommendationId: string }
  | { kind: 'recommendation'; recommendationIndex: number; readOnly?: true }
  | { kind: 'principle'; principleNumber: number }
  | { kind: 'no-recommendations' }
  | { kind: 'chemistry-clarification'; issue: ClarificationIssue; chemicals: string[] }

function parseClarificationChemicals(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_CLARIFICATION_CHEMICALS) {
    throw new Error(`Clarification scope takes at most ${MAX_CLARIFICATION_CHEMICALS} chemicals`)
  }
  const chemicals: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('Clarification chemicals must be strings')
    const name = item.trim()
    if (name.length > MAX_CLARIFICATION_CHEMICAL_CHARS) {
      throw new Error(`Clarification chemical names must be ${MAX_CLARIFICATION_CHEMICAL_CHARS} characters or fewer`)
    }
    if (name && !chemicals.includes(name)) chemicals.push(name)
  }
  return chemicals
}

export function parseTalkAboutScope(value: unknown): TalkAboutScope {
  if (!value || typeof value !== 'object') {
    throw new Error('Scope is required')
  }

  const scope = value as Record<string, unknown>
  if (scope.kind === 'recommendation' && typeof scope.recommendationId === 'string' && scope.recommendationId.trim()) {
    return { kind: 'recommendation', recommendationId: scope.recommendationId }
  }

  if (scope.kind === 'recommendation' && Number.isInteger(scope.recommendationIndex) && (scope.recommendationIndex as number) >= 0) {
    return { kind: 'recommendation', recommendationIndex: scope.recommendationIndex as number, readOnly: true }
  }

  if (scope.kind === 'principle' && typeof scope.principleNumber === 'number') {
    return { kind: 'principle', principleNumber: scope.principleNumber }
  }

  if (scope.kind === 'no-recommendations') {
    return { kind: 'no-recommendations' }
  }

  if (scope.kind === 'chemistry-clarification') {
    const issue = CLARIFICATION_ISSUES.find(candidate => candidate === scope.issue)
    if (!issue) throw new Error('Invalid chemistry clarification issue')
    return { kind: 'chemistry-clarification', issue, chemicals: parseClarificationChemicals(scope.chemicals) }
  }

  throw new Error('Invalid talk-about-this scope')
}

/** Scopes compare by their canonical parsed form, so key order and extra keys never matter. */
export function scopesEqual(left: TalkAboutScope, right: TalkAboutScope): boolean {
  return JSON.stringify(parseTalkAboutScope(left)) === JSON.stringify(parseTalkAboutScope(right))
}

/** Only a recommendation scope with a stable id can carry an approve/reject decision. */
export function canDecideRecommendation(
  scope: TalkAboutScope,
): scope is Extract<TalkAboutScope, { kind: 'recommendation'; recommendationId: string }> {
  return scope.kind === 'recommendation' && 'recommendationId' in scope
}

/** Read-only (index) scopes may never change anything, including proposing a procedure edit. */
export function canProposeProcedureEdit(scope: TalkAboutScope): boolean {
  return scope.kind !== 'recommendation' || 'recommendationId' in scope
}
