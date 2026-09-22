import { createHash, randomUUID } from 'node:crypto'
import { PARSE_SYSTEM_PROMPT } from '@/lib/prompts/parse'
import { PRINCIPLES, buildPrinciplePrompt } from '@/lib/prompts/principles'
import { buildAssemblePrompt } from '@/lib/prompts/assemble'
import { buildReevaluatePrompt, REEVALUATE_SCHEMA } from '@/lib/prompts/reevaluate'
import { citationFromEvidenceMatch } from '@/lib/literature-evidence'
import type { AnalysisMetadata } from '@/lib/version'
import type { LiteratureEvidenceMatch, Recommendation } from '@/lib/types'
import type { BenchmarkProvider, JsonCompletionRequest, JsonCompletion } from './provider'
import { ASSEMBLE_SCHEMA, PARSE_SCHEMA, PRINCIPLE_SCHEMA, type AssembleContract, type ParseContract, type PrincipleContract } from './contracts'

export interface StageShapeMetadata {
  schemaValid: boolean
  topLevelKeys: string[]
  recommendationCount?: number
  outputHash: string
}
export interface StageTelemetry {
  stage: string
  provider?: string
  model: string
  latencyMs: number
  usage?: JsonCompletion['usage']
  costUsd?: number
  generationId?: string
  shapeMetadata?: StageShapeMetadata
  error?: { message: string; category?: string; status?: number }
}
export interface BenchmarkRunInput {
  protocolText: string
  model: string
  provider: BenchmarkProvider
  frozenLiteratureMatches: LiteratureEvidenceMatch[]
  analysisMetadata: Readonly<AnalysisMetadata>
  now?: () => number
  idFactory?: () => string
}
export interface BenchmarkRunResult {
  parsed: ParseContract
  principleResults: PrincipleContract[]
  recommendations: Recommendation[]
  reevaluations: unknown[]
  assembled?: AssembleContract
  telemetry: StageTelemetry[]
}

class BenchmarkStageError extends Error {
  constructor(message: string) { super(message); this.name = 'BenchmarkStageError' }
}
const sanitizeError = (error: unknown): StageTelemetry['error'] => {
  const value = error as { category?: string; status?: number }
  return { message: 'Benchmark provider request failed', category: value?.category, status: value?.status }
}
const invalidError = (): StageTelemetry['error'] => ({ message: 'Invalid benchmark stage result' })
const outputShape = (data: unknown): StageShapeMetadata => {
  const record = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  const json = JSON.stringify(data) ?? ''
  return { schemaValid: true, topLevelKeys: Object.keys(record).sort(), recommendationCount: Array.isArray(record.recommendations) ? record.recommendations.length : undefined, outputHash: createHash('sha256').update(json).digest('hex') }
}

type Validator<T> = (value: unknown) => value is T
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const validParse: Validator<ParseContract> = (v): v is ParseContract => isRecord(v) && isString(v.protocolTitle) && isString(v.chemistrySubdomain) && Array.isArray(v.steps) && v.steps.every(s => isRecord(s) && isNumber(s.stepNumber) && isString(s.description) && Array.isArray(s.chemicals) && s.chemicals.every(c => isRecord(c) && isString(c.name) && isString(c.role)) && isRecord(s.conditions))
const validRecommendation: Validator<Recommendation> = (v): v is Recommendation => isRecord(v) && isNumber(v.stepNumber) && (v.principleNumbers === undefined || (Array.isArray(v.principleNumbers) && v.principleNumbers.every(isNumber))) && (v.principleNames === undefined || (Array.isArray(v.principleNames) && v.principleNames.every(isString))) && (v.severity === undefined || ['high', 'medium', 'low'].includes(v.severity as string)) && isRecord(v.original) && isString(v.original.chemical) && isString(v.original.issue) && isRecord(v.alternative) && isString(v.alternative.chemical) && isString(v.alternative.rationale) && (v.confidenceLevel === undefined || ['high', 'medium', 'low'].includes(v.confidenceLevel as string))
const validPrinciple: Validator<PrincipleContract> = (v): v is PrincipleContract => isRecord(v) && isNumber(v.principleNumber) && Array.isArray(v.recommendations) && v.recommendations.every(validRecommendation)
const validReevaluation: Validator<Record<string, unknown>> = (v): v is Record<string, unknown> => isRecord(v) && ['confirm', 'downgrade', 'suppress'].includes(v.action as string) && ['high', 'medium', 'low'].includes(v.revisedConfidence as string) && isString(v.revisedRationale) && isRecord(v.evidenceAssessment) && typeof v.evidenceAssessment.supportsOriginalIssue === 'boolean' && typeof v.evidenceAssessment.supportsAlternative === 'boolean' && ['strong', 'partial', 'weak', 'none'].includes(v.evidenceAssessment.contextMatch as string) && typeof v.evidenceAssessment.quantitativeData === 'boolean' && Array.isArray(v.concerns) && v.concerns.every(isString)
const validAssemble: Validator<AssembleContract> = (v): v is AssembleContract => isRecord(v) && isString(v.revisedProtocol) && isRecord(v.overallAssessment) && Array.isArray(v.overallAssessment.greenPrinciplesViolated) && isString(v.overallAssessment.mostImpactfulChange) && typeof v.overallAssessment.experimentalValidationNeeded === 'boolean' && isString(v.overallAssessment.disclaimer)

async function callStage<T>(input: BenchmarkRunInput, stage: string, system: string, user: string, schema: Record<string, unknown>, telemetry: StageTelemetry[], validate: Validator<T>): Promise<T> {
  const started = input.now?.() ?? Date.now()
  const request: JsonCompletionRequest = { model: input.model, stage, system, user, schema }
  try {
    const completion = await input.provider.completeJson<T>(request)
    if (!validate(completion.data)) {
      telemetry.push({ stage, provider: completion.provider, model: completion.model, latencyMs: (input.now?.() ?? Date.now()) - started, error: invalidError() })
      throw new BenchmarkStageError(`Invalid ${stage} stage result`)
    }
    telemetry.push({ stage, provider: completion.provider, model: completion.model, latencyMs: (input.now?.() ?? Date.now()) - started, usage: completion.usage, costUsd: completion.costUsd, generationId: completion.generationId, shapeMetadata: outputShape(completion.data) })
    return completion.data
  } catch (error) {
    if (error instanceof BenchmarkStageError) throw error
    const metadata = error as { provider?: string }
    telemetry.push({ stage, provider: metadata?.provider, model: input.model, latencyMs: (input.now?.() ?? Date.now()) - started, error: sanitizeError(error) })
    throw error
  }
}

function attachFrozenEvidence(rec: Recommendation, matches: LiteratureEvidenceMatch[]): Recommendation {
  const clean: Recommendation = { ...rec }
  delete clean.evidence
  if (matches.length === 0) return clean
  const citations = [] as NonNullable<Recommendation['evidence']>['citations']
  const whyReplacement = [] as NonNullable<Recommendation['evidence']>['why_replacement']
  for (const match of matches) {
    if (!citations.some(c => c.source_id === match.id)) citations.push(citationFromEvidenceMatch(match))
    if (!whyReplacement.some(item => item.source === match.title)) whyReplacement.push({ chemical: rec.alternative.chemical, source: match.title, content: `${match.candidateStatus === 'candidate_pending_adjudication' ? 'Candidate evidence — ' : ''}${match.quote}` })
  }
  return { ...clean, evidence: { why_flagged: [], citations, why_replacement: whyReplacement } }
}
function deduplicate(recs: Recommendation[], idFactory: () => string): Recommendation[] {
  const severity: Record<string, number> = { high: 3, medium: 2, low: 1 }
  const confidence: Record<string, number> = { high: 3, medium: 2, low: 1 }
  const map = new Map<string, { best: Recommendation; alternatives: Map<string, Recommendation['alternative']> }>()
  for (const source of recs) {
    const rec = { ...source, principleNumbers: [...source.principleNumbers], principleNames: [...source.principleNames], original: { ...source.original }, alternative: { ...source.alternative } }
    const key = `${rec.stepNumber}:${rec.original.chemical.toLowerCase()}`
    const slot = map.get(key)
    if (!slot) { map.set(key, { best: rec, alternatives: new Map([[rec.alternative.chemical.toLowerCase(), rec.alternative]]) }); continue }
    for (const n of rec.principleNumbers) if (!slot.best.principleNumbers.includes(n)) slot.best.principleNumbers.push(n)
    for (const n of rec.principleNames) if (!slot.best.principleNames.includes(n)) slot.best.principleNames.push(n)
    const altName = rec.alternative.chemical.toLowerCase()
    if (![...slot.alternatives.keys()].some(k => k.includes(altName) || altName.includes(k))) slot.alternatives.set(altName, rec.alternative)
    const wins = severity[rec.severity] > severity[slot.best.severity] || (severity[rec.severity] === severity[slot.best.severity] && confidence[rec.confidenceLevel] > confidence[slot.best.confidenceLevel])
    if (severity[rec.severity] > severity[slot.best.severity]) slot.best.severity = rec.severity
    if (confidence[rec.confidenceLevel] > confidence[slot.best.confidenceLevel]) slot.best.confidenceLevel = rec.confidenceLevel
    if (wins) { slot.best.original.issue = rec.original.issue; slot.best.alternative = rec.alternative }
  }
  return [...map.values()].map(slot => {
    const primary = slot.best.alternative.chemical.toLowerCase()
    const others = [...slot.alternatives.values()].filter(a => a.chemical.toLowerCase() !== primary)
    if (others.length) slot.best.alternative.rationale += ` Also consider: ${others.map(a => a.chemical).join(', ')}.`
    return { ...slot.best, id: slot.best.id ?? idFactory() }
  }).sort((a, b) => a.stepNumber - b.stepNumber || severity[b.severity] - severity[a.severity])
}
const deriveBenefit = (r: Recommendation): string => r.primaryBenefit || (r.principleNumbers.includes(1) ? 'Reduces direct chemical waste' : r.principleNumbers.includes(3) ? 'Lowers toxicity and hazard exposure' : r.principleNumbers.includes(5) ? 'Replaces hazardous solvent with safer alternative' : r.principleNumbers.includes(6) ? 'Reduces energy consumption' : r.principleNumbers.includes(12) ? 'Improves process safety' : r.principleNumbers.includes(9) ? 'Enables catalytic efficiency' : 'Improves green chemistry profile')

export async function runBenchmarkStages(input: BenchmarkRunInput): Promise<BenchmarkRunResult> {
  const telemetry: StageTelemetry[] = []
  const idFactory = input.idFactory ?? randomUUID
  let parsed: ParseContract
  try { parsed = await callStage(input, 'parse', PARSE_SYSTEM_PROMPT, input.protocolText, PARSE_SCHEMA, telemetry, validParse) } catch (error) { if (error instanceof BenchmarkStageError) throw new BenchmarkStageError('Benchmark parse stage failed'); throw new BenchmarkStageError('Benchmark parse stage failed') }
  const principleResults: PrincipleContract[] = []
  const raw: Recommendation[] = []
  for (const principle of PRINCIPLES) {
    try {
      const result = await callStage(input, `principle-${principle.number}`, buildPrinciplePrompt(principle, parsed.steps as never), `Analyze these protocol steps against Principle ${principle.number}:\n\n${JSON.stringify(parsed.steps, null, 2)}`, PRINCIPLE_SCHEMA, telemetry, validPrinciple)
      const recs = result.recommendations.map(r => {
        const rec = r as unknown as Partial<Recommendation>
        return {
          ...rec,
          principleNumbers: rec.principleNumbers?.length ? rec.principleNumbers : [principle.number],
          principleNames: rec.principleNames?.length ? rec.principleNames : [principle.name],
          severity: rec.severity ?? 'medium',
          confidenceLevel: rec.confidenceLevel ?? 'medium',
          alternative: { ...rec.alternative, yieldImpact: rec.alternative?.yieldImpact ?? 'unknown', caveats: rec.alternative?.caveats ?? '', evidenceBasis: rec.alternative?.evidenceBasis ?? 'benchmark' },
        } as Recommendation
      })
      principleResults.push({ ...result, recommendations: recs as unknown as Record<string, unknown>[] }); raw.push(...recs)
    } catch { /* isolate one principle */ }
  }
  if (principleResults.length === 0) throw new BenchmarkStageError('Benchmark principle evaluation failed')
  const deduped = deduplicate(raw.map(r => attachFrozenEvidence(r, input.frozenLiteratureMatches)), idFactory)
  if (deduped.length === 0) {
    const assembled: AssembleContract = {
      revisedProtocol: input.protocolText,
      overallAssessment: {
        greenPrinciplesViolated: [],
        mostImpactfulChange: 'No changes needed — this protocol already follows green chemistry principles.',
        experimentalValidationNeeded: false,
        disclaimer: 'This protocol was evaluated against all 12 Principles of Green Chemistry and no significant improvements were identified.',
      },
    }
    return { parsed, principleResults, recommendations: [], reevaluations: [], assembled, telemetry }
  }
  const reevaluations: unknown[] = []
  const kept: Recommendation[] = []
  for (let index = 0; index < deduped.length; index++) {
    const rec = deduped[index]
    const stage = `reevaluate-${index + 1}-${rec.stepNumber}`
    try {
      const reevaluation = await callStage(input, stage, buildReevaluatePrompt(rec, input.frozenLiteratureMatches), 'Re-evaluate this recommendation based on the retrieved literature evidence.', REEVALUATE_SCHEMA as unknown as Record<string, unknown>, telemetry, validReevaluation)
      reevaluations.push(reevaluation)
      const candidateOnly = input.frozenLiteratureMatches.length > 0 && input.frozenLiteratureMatches.every(m => m.candidateStatus === 'candidate_pending_adjudication')
      const enforced = candidateOnly && reevaluation.action !== 'downgrade' ? { ...reevaluation, action: 'downgrade', revisedConfidence: 'low', concerns: [...(reevaluation.concerns as string[]), 'Candidate-only evidence cannot independently confirm or suppress this intervention.'] } : reevaluation
      if (enforced.action !== 'suppress') {
        const evidence = rec.evidence ?? { why_flagged: [], why_replacement: [], citations: [] }
        kept.push({ ...rec, confidenceLevel: enforced.revisedConfidence as Recommendation['confidenceLevel'], severity: (enforced.revisedSeverity as Recommendation['severity'] | undefined) ?? rec.severity, evidence: { ...evidence, reevaluationMeta: enforced.evidenceAssessment } as Recommendation['evidence'], alternative: { ...rec.alternative, rationale: enforced.revisedRationale as string, caveats: [rec.alternative.caveats, ...(enforced.concerns as string[])].filter(Boolean).join('; ') } })
      }
    } catch { kept.push(rec) }
  }
  for (const rec of kept) { rec.evidenceTier = (rec.evidence?.citations.length ?? 0) > 0 ? 'sourced' : 'inferred'; rec.primaryBenefit = deriveBenefit(rec); rec.citationMetadata = { gcaiVersion: input.analysisMetadata.gcaiVersion, generatedAt: input.analysisMetadata.generatedAt } }
  kept.sort((a, b) => {
    const scoreA = ({ high: 3, medium: 2, low: 1 }[a.severity] ?? 1) * (a.evidenceTier === 'sourced' ? 1.5 : 1)
    const scoreB = ({ high: 3, medium: 2, low: 1 }[b.severity] ?? 1) * (b.evidenceTier === 'sourced' ? 1.5 : 1)
    if (scoreB !== scoreA) return scoreB - scoreA
    if (a.evidenceTier === 'sourced' && b.evidenceTier !== 'sourced') return -1
    if (b.evidenceTier === 'sourced' && a.evidenceTier !== 'sourced') return 1
    return 0
  })
  let assembled: AssembleContract
  try { assembled = await callStage(input, 'assemble', buildAssemblePrompt(input.protocolText, parsed.steps as never, kept), 'Generate the revised protocol and overall assessment based on the recommendations above.', ASSEMBLE_SCHEMA, telemetry, validAssemble) } catch { throw new BenchmarkStageError('Benchmark assembly stage failed') }
  return { parsed, principleResults, recommendations: kept, reevaluations, assembled, telemetry }
}
export class BenchmarkStageRunner { constructor(private readonly input: BenchmarkRunInput) {} run(): Promise<BenchmarkRunResult> { return runBenchmarkStages(this.input) } }
