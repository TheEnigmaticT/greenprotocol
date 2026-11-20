import { createHash, randomBytes } from 'node:crypto'
import { isEligibleToReviseProcedure } from '@/lib/recommendation-eligibility'
import type { Recommendation } from '@/lib/types'

export const SCISURE_VERSION = 1
export const MAX_SOURCE_BYTES = 64 * 1024
export const MAX_SELECTIONS = 100
const ID = /^[A-Za-z0-9._:-]{1,160}$/
const NONCE = /^[a-f0-9]{64}$/
const BIDI_OR_INVISIBLE = /[\u0000\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/
const ACTIVE_MARKUP = /<(?:script|style|iframe|object|embed|svg|math|img|video|audio|canvas)\b/i

export type SciSureSelection = {
  sectionId?: string
  stepId?: string
  order: number
  title?: string
  originalContent: string
  normalizedText: string
}

export type SciSureSource = {
  version: 1
  kind: 'experiment' | 'protocol' | 'protocol-step'
  externalId: string
  externalVersionId?: string
  title: string
  retrievedAt: string
  selection: SciSureSelection[]
  protocolText: string
  importWarnings: string[]
}

export type SciSureAdmission = {
  nonce: string
  bridgeSessionId: string
  requestId: string
  source: SciSureSource
  sourceHash: string
  email: { address?: string; deliveryConsent: boolean; marketingConsent: boolean }
  unverifiedUserClaim?: Record<string, string>
}

function fail(message: string): never { throw new Error(message) }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected an object.')
  return value as Record<string, unknown>
}
function string(value: unknown, field: string, max = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Invalid ${field}.`)
  if (BIDI_OR_INVISIBLE.test(value)) fail(`Invalid ${field}: bidi or invisible controls are not accepted.`)
  return value
}
function byteLength(value: unknown) { return Buffer.byteLength(JSON.stringify(value), 'utf8') }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
export function sourceProvenanceHash(source: SciSureSource): string {
  const provenance = {
    kind: source.kind, externalId: source.externalId, externalVersionId: source.externalVersionId || null,
    selection: source.selection.map(({ sectionId, stepId, order, title, originalContent, normalizedText }) => ({ sectionId: sectionId || null, stepId: stepId || null, order, title: title || '', originalContent, normalizedText })),
  }
  return createHash('sha256').update(canonical(provenance)).digest('hex')
}

function sourceFrom(value: unknown): SciSureSource {
  const raw = record(value)
  if (raw.version !== 1 || !['experiment', 'protocol', 'protocol-step'].includes(String(raw.kind))) fail('Unsupported source version or kind.')
  const selectionRaw = raw.selection
  if (!Array.isArray(selectionRaw) || !selectionRaw.length || selectionRaw.length > MAX_SELECTIONS) fail(`Source selection must contain 1-${MAX_SELECTIONS} entries.`)
  const selection = selectionRaw.map((item, index) => {
    const choice = record(item)
    const originalContent = string(choice.originalContent, `selection ${index + 1} original content`, MAX_SOURCE_BYTES)
    if (ACTIVE_MARKUP.test(originalContent)) fail('Active markup is not accepted in source content.')
    const normalizedText = string(choice.normalizedText, `selection ${index + 1} normalized text`, MAX_SOURCE_BYTES)
    if (!Number.isFinite(choice.order)) fail(`Invalid selection ${index + 1} order.`)
    const sectionId = choice.sectionId === undefined ? undefined : string(choice.sectionId, 'section id', 160)
    const stepId = choice.stepId === undefined ? undefined : string(choice.stepId, 'step id', 160)
    if (!sectionId && !stepId) fail('Each selection requires a source section or step identity.')
    return { sectionId, stepId, order: Number(choice.order), title: choice.title === undefined ? undefined : string(choice.title, 'selection title', 512), originalContent, normalizedText }
  })
  const source: SciSureSource = {
    version: 1,
    kind: raw.kind as SciSureSource['kind'],
    externalId: string(raw.externalId, 'external source id', 160),
    externalVersionId: raw.externalVersionId === undefined ? undefined : string(raw.externalVersionId, 'external version id', 160),
    title: string(raw.title, 'source title', 512),
    retrievedAt: string(raw.retrievedAt, 'retrieved at', 64),
    selection,
    protocolText: typeof raw.protocolText === 'string' && raw.protocolText.length > MAX_SOURCE_BYTES
      ? fail('Source exceeds the 64 KiB limit.')
      : string(raw.protocolText, 'protocol text', MAX_SOURCE_BYTES),
    importWarnings: Array.isArray(raw.importWarnings) ? raw.importWarnings.map((warning) => string(warning, 'import warning', 512)) : fail('Invalid import warnings.'),
  }
  if (byteLength(source) > MAX_SOURCE_BYTES) fail('Source exceeds the 64 KiB limit.')
  // The worker executes this field. Bind it exactly to the reviewed normalized
  // selections so an admitted payload cannot smuggle a different top-level body.
  const expectedProtocolText = selection.map((item) => `## ${item.title || 'Untitled selection'}\n${item.normalizedText}`).join('\n\n')
  if (source.protocolText !== expectedProtocolText) fail('Protocol text must exactly match the reviewed normalized selections.')
  return source
}

export function parseSciSureAdmission(value: unknown): SciSureAdmission {
  const raw = record(value)
  if (raw.version !== SCISURE_VERSION || raw.type !== 'scisure.gcai.admission') fail('Unsupported admission message.')
  const nonce = string(raw.nonce, 'nonce', 64)
  if (!NONCE.test(nonce)) fail('Invalid nonce.')
  const bridgeSessionId = string(raw.bridgeSessionId, 'bridge session id', 160)
  if (!ID.test(bridgeSessionId)) fail('Invalid bridge session id.')
  const requestId = string(raw.requestId, 'request id', 160)
  if (!ID.test(requestId)) fail('Invalid request id.')
  const emailRaw = raw.email === undefined ? {} : record(raw.email)
  const deliveryConsent = emailRaw.deliveryConsent === true
  const marketingConsent = emailRaw.marketingConsent === true
  if (emailRaw.deliveryConsent !== undefined && typeof emailRaw.deliveryConsent !== 'boolean') fail('Invalid delivery consent.')
  if (emailRaw.marketingConsent !== undefined && typeof emailRaw.marketingConsent !== 'boolean') fail('Invalid marketing consent.')
  const address = emailRaw.address === undefined ? undefined : string(emailRaw.address, 'email address', 254)
  if (address && !deliveryConsent && !marketingConsent) fail('An email address requires an explicit email purpose.')
  if ((deliveryConsent || marketingConsent) && (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))) fail('A valid email address is required for the selected purpose.')
  const userClaim = raw.userClaim === undefined ? undefined : record(raw.userClaim)
  const unverifiedUserClaim = userClaim ? Object.fromEntries(Object.entries(userClaim).filter(([, item]) => typeof item === 'string' && item.length <= 160)) as Record<string, string> : undefined
  const source = sourceFrom(raw.source)
  return { nonce, bridgeSessionId, requestId, source, sourceHash: sourceProvenanceHash(source), email: { address, deliveryConsent, marketingConsent }, unverifiedUserClaim }
}

export function validateBridgeMessage(value: unknown): { version: 1; type: 'scisure.gcai.hello'; nonce: string } {
  const raw = record(value)
  if (raw.version !== 1 || raw.type !== 'scisure.gcai.hello') fail('Unsupported bridge message.')
  const nonce = string(raw.nonce, 'nonce', 64)
  if (!NONCE.test(nonce) || Object.keys(raw).length !== 3) fail('Invalid bridge hello.')
  return { version: 1, type: 'scisure.gcai.hello', nonce }
}

export function createBridgeCredential() {
  return { id: randomBytes(12).toString('base64url'), secret: randomBytes(32).toString('base64url') }
}
export async function hashBridgeCredential(secret: string): Promise<string> {
  return createHash('sha256').update(secret).digest('hex')
}

export type RawRecommendation = Recommendation
export type SciSureReviewDecision = 'approved_for_experiment' | 'rejected'
export type SciSureProjectionSelection = Pick<SciSureSelection, 'stepId' | 'order'>

function boundedText(value: unknown, maximum: number, chemistry = false): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text && text.length <= maximum && !BIDI_OR_INVISIBLE.test(text) && (!chemistry || !/[<>\u0000]/.test(text)) ? text : null
}

export function projectSciSureResult(input: {
  bridgeSessionId: string
  snapshotId: string
  sourceHash: string
  runId: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'uncertain'
  analysisId?: string
  revisionNumber?: number
  selection?: SciSureProjectionSelection[]
  recommendations?: RawRecommendation[]
  reviewDecisions?: Record<string, SciSureReviewDecision>
}) {
  const recommendations = input.status === 'completed' ? (input.recommendations || []).flatMap((rec) => {
    const originalChemical = boundedText(rec.original?.chemical, 512, true)
    const alternativeChemical = boundedText(rec.alternative?.chemical, 512, true)
    const caveats = boundedText(rec.alternative?.caveats, 1024)
    if (!rec.id || !ID.test(rec.id) || rec.cardKind !== 'swap' || !originalChemical || !alternativeChemical || !caveats || !['high', 'medium', 'low'].includes(rec.confidenceLevel) || !isEligibleToReviseProcedure(rec.evidenceAssessment)) return []
    const reviewed = input.reviewDecisions?.[rec.id]
    const decision = reviewed === 'approved_for_experiment' ? 'accepted' as const : reviewed === 'rejected' ? 'rejected' as const : 'proposed' as const
    const sourceStepId = input.selection?.find((selection) => selection.order === rec.stepNumber)?.stepId || null
    return [{ recommendationId: rec.id, sourceStepId, originalChemical, alternativeChemical, kind: 'chemical-substitution' as const, decision, confidence: rec.confidenceLevel, caveats, requiresScientistReview: true as const }]
  }) : []
  return { version: 1 as const, ...input, recommendations: recommendations.length ? recommendations : undefined }
}
