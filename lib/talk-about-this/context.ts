import { createHash } from 'node:crypto'
import type { AnalysisResult, AnalysisStep, ChemistryDataStatus, Citation, PrincipleScore, Recommendation, UnresolvedMaterialDetail } from '@/lib/types'
import { parseTalkAboutScope, type TalkAboutScope } from '@/lib/talk-about-this/scope'

export type { TalkAboutScope } from '@/lib/talk-about-this/scope'
export { parseTalkAboutScope } from '@/lib/talk-about-this/scope'

const CONTEXT_SCHEMA_VERSION = 1
const MAX_PROTOCOL_CHARACTERS = 12_000
const PROTOCOL_TRUNCATION_MARKER = '\n\n[Protocol truncated for chat context]'

export interface ContextCitation extends Citation {
  id: string
}

export interface TalkAboutChemistryDataStatus {
  pending: boolean
  deterministicScoringAvailable: boolean
  unresolvedChemicals: string[]
  indefiniteChemicals: string[]
  unresolvedDetails?: UnresolvedMaterialDetail[]
  message: string
}

/** Reference-lookup outcome for a chemical the scientist is asking about (clarification scope only). */
export interface TalkAboutReferenceStatus {
  name: string
  stepNumber?: number
  referenceStatus: string
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
  chemistryDataStatus?: TalkAboutChemistryDataStatus
  referenceStatuses?: TalkAboutReferenceStatus[]
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
    : `${protocolText.slice(0, MAX_PROTOCOL_CHARACTERS)}${PROTOCOL_TRUNCATION_MARKER}`
}

/** True when the frozen snapshot holds only the first part of the saved protocol text. */
export function isProtocolTruncated(context: Pick<TalkAboutContext, 'protocolText'>): boolean {
  return context.protocolText.endsWith(PROTOCOL_TRUNCATION_MARKER)
}

function snapshotRecommendation(recommendation: Recommendation): Recommendation {
  const { isAccepted: _isAccepted, ...snapshot } = recommendation
  return snapshot
}

function snapshotChemistryDataStatus(status: ChemistryDataStatus | undefined): TalkAboutChemistryDataStatus | undefined {
  if (!status) return undefined
  return {
    pending: status.pending,
    deterministicScoringAvailable: status.deterministicScoringAvailable,
    unresolvedChemicals: [...status.unresolvedChemicals],
    indefiniteChemicals: [...(status.indefiniteChemicals ?? [])],
    ...(status.unresolvedDetails ? { unresolvedDetails: status.unresolvedDetails.map(detail => ({ ...detail })) } : {}),
    message: status.message,
  }
}

function clarificationChemicalKey(name: string): string {
  return name.trim().toLocaleLowerCase()
}

/** Every named chemical must be one this saved analysis actually contains or flagged. */
function assertClarificationChemicals(analysis: AnalysisResult, chemicals: readonly string[]): void {
  const known: Record<string, true> = {}
  for (const step of analysis.steps) {
    for (const chemical of step.chemicals) known[clarificationChemicalKey(chemical.name)] = true
  }
  const status = analysis.chemistryDataStatus
  for (const name of [...(status?.unresolvedChemicals ?? []), ...(status?.indefiniteChemicals ?? [])]) {
    known[clarificationChemicalKey(name)] = true
  }
  for (const detail of status?.unresolvedDetails ?? []) known[clarificationChemicalKey(detail.name)] = true

  const unknown = chemicals.find(name => known[clarificationChemicalKey(name)] !== true)
  if (unknown !== undefined) {
    throw new Error('Clarification chemical is not part of this analysis')
  }
}

function referenceStatusesFor(analysis: AnalysisResult, chemicals: readonly string[]): TalkAboutReferenceStatus[] {
  const wanted: Record<string, true> = {}
  for (const name of chemicals) wanted[clarificationChemicalKey(name)] = true
  return (analysis.enrichedChemicals ?? [])
    .filter(chemical => wanted[clarificationChemicalKey(chemical.name)] === true)
    .map(chemical => ({
      name: chemical.name,
      ...(chemical.stepNumber === undefined ? {} : { stepNumber: chemical.stepNumber }),
      referenceStatus: chemical.reference_status ?? 'not reported',
    }))
}

/** Scopes that discuss the whole procedure rather than specific recommendations. */
function isProtocolLevelScope(
  scope: TalkAboutScope,
): scope is Extract<TalkAboutScope, { kind: 'no-recommendations' | 'chemistry-clarification' }> {
  return scope.kind === 'no-recommendations' || scope.kind === 'chemistry-clarification'
}

function resolveRecommendations(analysis: AnalysisResult, scope: TalkAboutScope): Recommendation[] {
  if (isProtocolLevelScope(scope)) {
    return []
  }

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

function relevantSteps(
  analysis: AnalysisResult,
  scope: TalkAboutScope,
  recommendations: Recommendation[],
): AnalysisStep[] {
  if (isProtocolLevelScope(scope)) {
    return analysis.steps
  }
  const stepNumbers = new Set(recommendations.map(item => item.stepNumber))
  return analysis.steps.filter(step => stepNumbers.has(step.stepNumber))
}

function relevantScores(analysis: AnalysisResult, scope: TalkAboutScope, recommendations: Recommendation[]): PrincipleScore[] {
  if (isProtocolLevelScope(scope)) {
    return analysis.deterministicScores?.scores ?? []
  }

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
  const chemistryDataStatus = isProtocolLevelScope(input.scope)
    ? snapshotChemistryDataStatus(input.analysis.chemistryDataStatus)
    : undefined
  let referenceStatuses: TalkAboutReferenceStatus[] | undefined
  if (input.scope.kind === 'chemistry-clarification') {
    assertClarificationChemicals(input.analysis, input.scope.chemicals)
    referenceStatuses = referenceStatusesFor(input.analysis, input.scope.chemicals)
  }

  const contextWithoutHash = {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    analysisId: input.analysisId,
    scope: input.scope,
    protocolTitle: input.analysis.protocolTitle,
    protocolText: truncateProtocol(input.protocolText),
    steps: relevantSteps(input.analysis, input.scope, recommendations),
    recommendations,
    scores: relevantScores(input.analysis, input.scope, recommendations),
    citations: collectCitations(recommendations),
    noDirectEvidence: recommendations.every(item => (item.evidence?.citations.length ?? 0) === 0),
    ...(chemistryDataStatus ? { chemistryDataStatus } : {}),
    ...(referenceStatuses ? { referenceStatuses } : {}),
  }

  return {
    ...contextWithoutHash,
    contextHash: hashContext(contextWithoutHash),
  }
}
