export type TalkAboutScope =
  | { kind: 'recommendation'; recommendationId: string }
  | { kind: 'recommendation'; recommendationIndex: number; readOnly?: true }
  | { kind: 'principle'; principleNumber: number }

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

  throw new Error('Invalid talk-about-this scope')
}
