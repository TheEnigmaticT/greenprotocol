import { createHash } from 'node:crypto'
import type { AnalysisResult, AnalysisStep, Citation, PrincipleScore, Recommendation } from '@/lib/types'

const CONTEXT_SCHEMA_VERSION = 1
const MAX_PROTOCOL_CHARACTERS = 12_000

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

export interface ContextCitation extends Citation {
  id: string
}

export interface TalkAboutContext {
  schemaVersion: number
  analysisId: string
  scope: TalkAboutScope
  protocolTitle: string
  protocolText: string
  steps: AnalysisStep[]
  recommendations: Recommendation[]
  scores: PrincipleScore[]
  citations: ContextCitation[]
  noDirectEvidence: boolean
  contextHash: string
}

export interface BuildTalkAboutContextInput {
  analysisId: string
  protocolText: string
  analysis: AnalysisResult
  scope: TalkAboutScope
}

function truncateProtocol(protocolText: string): string {
  return protocolText.length <= MAX_PROTOCOL_CHARACTERS
    ? protocolText
    : `${protocolText.slice(0, MAX_PROTOCOL_CHARACTERS)}\n\n[Protocol truncated for chat context]`
}

function snapshotRecommendation(recommendation: Recommendation): Recommendation {
  const { isAccepted: _isAccepted, ...snapshot } = recommendation
  return snapshot
}

function resolveRecommendations(analysis: AnalysisResult, scope: TalkAboutScope): Recommendation[] {
  if (scope.kind === 'recommendation') {
    const matches = 'recommendationId' in scope
      ? analysis.recommendations.filter(item => item.id === scope.recommendationId)
      : [analysis.recommendations[scope.recommendationIndex]].filter((item): item is Recommendation => Boolean(item))

    if (matches.length !== 1) {
      throw new Error('Recommendation scope does not match exactly one recommendation in this analysis')
    }

    return matches.map(snapshotRecommendation)
  }

  if (!Number.isInteger(scope.principleNumber) || scope.principleNumber < 1 || scope.principleNumber > 12) {
    throw new Error('Principle scope must be between 1 and 12')
  }

  return analysis.recommendations
    .filter(item => item.principleNumbers.includes(scope.principleNumber))
    .map(snapshotRecommendation)
}

function relevantSteps(analysis: AnalysisResult, recommendations: Recommendation[]): AnalysisStep[] {
  const stepNumbers = new Set(recommendations.map(item => item.stepNumber))
  return analysis.steps.filter(step => stepNumbers.has(step.stepNumber))
}

function relevantScores(analysis: AnalysisResult, scope: TalkAboutScope, recommendations: Recommendation[]): PrincipleScore[] {
  const principleNumbers = scope.kind === 'principle'
    ? [scope.principleNumber]
    : [...new Set(recommendations.flatMap(item => item.principleNumbers))]

  return analysis.deterministicScores?.scores.filter(score => principleNumbers.includes(score.principle_number)) ?? []
}

function collectCitations(recommendations: Recommendation[]): ContextCitation[] {
  const citations = new Map<string, ContextCitation>()

  for (const recommendation of recommendations) {
    for (const citation of recommendation.evidence?.citations ?? []) {
      const id = citation.source_id.trim()
      if (id) {
        citations.set(id, { ...citation, id })
      }
    }
  }

  return [...citations.values()]
}

function hashContext(context: Omit<TalkAboutContext, 'contextHash'>): string {
  return createHash('sha256').update(JSON.stringify(context)).digest('hex')
}

export function buildTalkAboutContext(input: BuildTalkAboutContextInput): TalkAboutContext {
  const recommendations = resolveRecommendations(input.analysis, input.scope)
  const contextWithoutHash = {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    analysisId: input.analysisId,
    scope: input.scope,
    protocolTitle: input.analysis.protocolTitle,
    protocolText: truncateProtocol(input.protocolText),
    steps: relevantSteps(input.analysis, recommendations),
    recommendations,
    scores: relevantScores(input.analysis, input.scope, recommendations),
    citations: collectCitations(recommendations),
    noDirectEvidence: recommendations.every(item => (item.evidence?.citations.length ?? 0) === 0),
  }

  return {
    ...contextWithoutHash,
    contextHash: hashContext(contextWithoutHash),
  }
}
