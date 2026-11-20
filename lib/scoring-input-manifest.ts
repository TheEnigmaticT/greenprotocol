/**
 * Versioned immutable scoring-input manifest for GreenChemistry.ai.
 *
 * Goal: preserve, alongside the analysis result, the exact inputs that were
 * used to compute the deterministic scores so an auditor can replay the
 * frozen result later without relying on hidden canonical-score caching and
 * without re-running the chemistry service. The manifest is an
 * integrity checksum of the inputs, NOT a cryptographic signature or
 * authentication artifact.
 *
 * Lifecycle:
 *  - `buildScoringInputManifest` clones caller data so subsequent caller
 *    mutations cannot alter the manifest, freezes nested objects, and emits
 *    a canonical-JSON digest with sorted keys (arrays preserve order).
 *  - `replayFrozenScoring` verifies schema version, digest, source hash,
 *    and methodology version, then returns a deep copy of the scores.
 *    It does not call the chemistry service or any provider; the stored
 *    result is the replay result.
 */

import { createHash } from 'node:crypto'
import type {
  DeterministicScores,
  EnrichedChemical,
} from '@/lib/types'

/** Pin the manifest schema so future migrations are explicit. */
export const SCORING_INPUT_MANIFEST_SCHEMA_VERSION = 1 as const

/** Parameters for `scoreProtocol` (avoids leaking the chemistry-service shape). */
export type ScoringRequest = Parameters<
  typeof import('@/lib/chemistry-service').scoreProtocol
>[0]

export interface ScoringInputProvenance {
  methodologyVersion: string
  model: string
  promptHash: string
  schemaHash: string
  /** null when no web revision was relevant (e.g. literature search was skipped). */
  webRevision: string | null
}

export interface ScoringInputManifest {
  schemaVersion: typeof SCORING_INPUT_MANIFEST_SCHEMA_VERSION
  sourceHash: string
  /** SHA-256 of canonical-JSON over all other fields, hex. */
  digest: string
  request: ScoringRequest
  references: EnrichedChemical[]
  scores: DeterministicScores
  warnings: string[]
  provenance: ScoringInputProvenance
}

export interface BuildScoringInputManifestInput {
  sourceText: string
  request: ScoringRequest
  scores: DeterministicScores
  references: EnrichedChemical[]
  warnings: string[]
  provenance: ScoringInputProvenance
}

export interface ReplayExpected {
  sourceText: string
  methodologyVersion: string
}

export interface StoredResultReplay {
  mode: 'stored-result-replay'
  recomputed: false
  /** A deep copy of the stored scores; mutating this never alters the manifest. */
  scores: DeterministicScores
}

/**
 * Stable JSON-compatible serialization with object keys sorted
 * lexicographically and arrays preserving their input order.
 *
 * Mirrors `JSON.stringify` semantics for non-JSON values so the digest
 * survives Supabase JSON storage and round-trip:
 *   - undefined object properties are omitted (matches JSON.stringify)
 *   - undefined in arrays is encoded as null (matches JSON.stringify)
 *   - functions and symbols are likewise omitted/null (matches JSON.stringify)
 *   - non-finite numbers (NaN, Infinity, -Infinity) and BigInts throw
 *   - cyclic structures throw
 *
 * Strings, numbers, booleans, null, arrays, and plain objects are
 * preserved byte-for-byte except for the canonical key ordering.
 */
function canonicalStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  const stringify = (node: unknown): string => {
    if (node === undefined) {
      throw new Error('canonicalStringify: encountered undefined in array position')
    }
    if (typeof node === 'bigint') {
      throw new Error('canonicalStringify: BigInt is not JSON-compatible')
    }
    if (typeof node === 'function' || typeof node === 'symbol') {
      throw new Error('canonicalStringify: functions/symbols are not JSON-compatible')
    }
    if (node === null || typeof node !== 'object') {
      if (typeof node === 'number' && !Number.isFinite(node)) {
        throw new Error('canonicalStringify: non-finite numbers are not JSON-compatible')
      }
      return JSON.stringify(node)
    }
    if (seen.has(node as object)) {
      throw new Error('Cannot canonicalize cyclic structure')
    }
    seen.add(node as object)
    if (Array.isArray(node)) {
      // JSON.stringify encodes array holes and undefined entries as null.
      return '[' + node.map((item) => (item === undefined ? 'null' : stringify(item))).join(',') + ']'
    }
    const obj = node as Record<string, unknown>
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stringify(obj[k])).join(',') + '}'
  }
  return stringify(value)
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  // Freeze arrays and plain objects deeply.
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item)
  } else {
    const proto = Object.getPrototypeOf(value)
    if (proto === Object.prototype || proto === null) {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        deepFreeze((value as Record<string, unknown>)[key])
      }
    }
  }
  Object.freeze(value)
  return value
}

function deepClone<T>(value: T): T {
  // structuredClone handles cycles, Maps, Sets, Dates, etc., and is available
  // in the Node runtime used by the Next.js app. It preserves array order
  // and produces a structurally-detached copy.
  return structuredClone(value)
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function computeDigest(payload: {
  sourceHash: string
  request: ScoringRequest
  references: EnrichedChemical[]
  scores: DeterministicScores
  warnings: string[]
  provenance: ScoringInputProvenance
}): string {
  // The schemaVersion is not part of the digest payload: it is a literal
  // discriminator and is checked separately by the replay function.
  return sha256Hex(canonicalStringify(payload))
}

export function buildScoringInputManifest(
  input: BuildScoringInputManifestInput,
): ScoringInputManifest {
  if (!input || typeof input !== 'object') {
    throw new Error('buildScoringInputManifest: input is required')
  }
  if (typeof input.sourceText !== 'string') {
    throw new Error('buildScoringInputManifest: sourceText must be a string')
  }
  if (!input.request || typeof input.request !== 'object') {
    throw new Error('buildScoringInputManifest: request is required')
  }
  if (!input.scores || typeof input.scores !== 'object') {
    throw new Error('buildScoringInputManifest: scores are required')
  }
  if (!Array.isArray(input.references)) {
    throw new Error('buildScoringInputManifest: references must be an array')
  }
  if (!Array.isArray(input.warnings)) {
    throw new Error('buildScoringInputManifest: warnings must be an array')
  }
  if (!input.provenance || typeof input.provenance !== 'object') {
    throw new Error('buildScoringInputManifest: provenance is required')
  }

  const sourceHash = sha256Hex(input.sourceText)
  const request = deepClone(input.request)
  const references = deepClone(input.references)
  const scores = deepClone(input.scores)
  const warnings = deepClone(input.warnings)
  const provenance = deepClone(input.provenance)

  const digest = computeDigest({
    sourceHash,
    request,
    references,
    scores,
    warnings,
    provenance,
  })

  deepFreeze(request)
  deepFreeze(references)
  deepFreeze(scores)
  deepFreeze(warnings)
  deepFreeze(provenance)

  return {
    schemaVersion: SCORING_INPUT_MANIFEST_SCHEMA_VERSION,
    sourceHash,
    digest,
    request,
    references,
    scores,
    warnings,
    provenance,
  }
}

function manifestToDigestPayload(manifest: ScoringInputManifest): Parameters<typeof computeDigest>[0] {
  return {
    sourceHash: manifest.sourceHash,
    request: manifest.request,
    references: manifest.references,
    scores: manifest.scores,
    warnings: manifest.warnings,
    provenance: manifest.provenance,
  }
}

/**
 * Verify a stored manifest and return a deep copy of its scores without
 * contacting any provider or service. Throws on:
 *   - non-1 schemaVersion
 *   - tampered digest
 *   - sourceHash mismatch with expected.sourceText
 *   - methodologyVersion mismatch with expected.methodologyVersion
 *   - tampered scores (digest mismatch)
 *   - missing required methodologyVersion (legacy input without provenance)
 *
 * Accepts `unknown` so the caller does not need to assert the type of
 * data read back from storage; validation happens inside the function.
 *
 * The digest is an integrity checksum, not a signature: do not claim it
 * proves authenticity or authorship.
 */
export function replayFrozenScoring(
  manifest: unknown,
  expected: ReplayExpected,
): StoredResultReplay {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('replayFrozenScoring: manifest is required')
  }
  const m = manifest as ScoringInputManifest
  if (m.schemaVersion !== SCORING_INPUT_MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `replayFrozenScoring: unsupported schemaVersion ${m.schemaVersion}; expected ${SCORING_INPUT_MANIFEST_SCHEMA_VERSION}`,
    )
  }
  if (!expected || typeof expected !== 'object') {
    throw new Error('replayFrozenScoring: expected is required')
  }
  if (typeof expected.sourceText !== 'string') {
    throw new Error('replayFrozenScoring: expected.sourceText must be a string')
  }
  if (typeof expected.methodologyVersion !== 'string' || expected.methodologyVersion.length === 0) {
    throw new Error('replayFrozenScoring: expected.methodologyVersion is required')
  }
  if (!m.provenance || typeof m.provenance !== 'object') {
    throw new Error('replayFrozenScoring: manifest provenance is missing')
  }
  if (typeof m.provenance.methodologyVersion !== 'string' || m.provenance.methodologyVersion.length === 0) {
    throw new Error('replayFrozenScoring: legacy manifest missing methodologyVersion is not replayable')
  }
  if (typeof m.sourceHash !== 'string' || m.sourceHash.length !== 64) {
    throw new Error('replayFrozenScoring: manifest sourceHash is missing or malformed')
  }
  if (typeof m.digest !== 'string' || m.digest.length !== 64) {
    throw new Error('replayFrozenScoring: manifest digest is missing or malformed')
  }

  const expectedSourceHash = sha256Hex(expected.sourceText)
  if (expectedSourceHash !== m.sourceHash) {
    throw new Error('replayFrozenScoring: expected.sourceText does not match manifest.sourceHash')
  }
  if (expected.methodologyVersion !== m.provenance.methodologyVersion) {
    throw new Error(
      `replayFrozenScoring: methodologyVersion mismatch (expected ${expected.methodologyVersion}, stored ${m.provenance.methodologyVersion})`,
    )
  }

  const recomputed = computeDigest(manifestToDigestPayload(m))
  if (recomputed !== m.digest) {
    throw new Error('replayFrozenScoring: manifest digest mismatch — manifest has been tampered with')
  }

  return {
    mode: 'stored-result-replay',
    recomputed: false,
    scores: deepClone(m.scores),
  }
}

// ─── Manifest preservation for analysis-result PATCH writes ──────────

/**
 * Shape-only validation that does NOT recompute the digest. A stored
 * manifest that passes `isValidManifestShape` may still be tampered;
 * the route must also check structural equality against the stored
 * record before accepting a client echo.
 */
export function isValidManifestShape(value: unknown): value is ScoringInputManifest {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  if (m.schemaVersion !== SCORING_INPUT_MANIFEST_SCHEMA_VERSION) return false
  if (typeof m.sourceHash !== 'string' || m.sourceHash.length !== 64) return false
  if (typeof m.digest !== 'string' || m.digest.length !== 64) return false
  if (!m.request || typeof m.request !== 'object') return false
  if (!Array.isArray(m.references)) return false
  if (!m.scores || typeof m.scores !== 'object') return false
  if (!Array.isArray(m.warnings)) return false
  if (!m.provenance || typeof m.provenance !== 'object') return false
  const p = m.provenance as Record<string, unknown>
  if (typeof p.methodologyVersion !== 'string' || p.methodologyVersion.length === 0) return false
  if (typeof p.model !== 'string') return false
  if (typeof p.promptHash !== 'string') return false
  if (typeof p.schemaHash !== 'string') return false
  if (p.webRevision !== null && typeof p.webRevision !== 'string') return false
  return true
}

/**
 * Structural equality using canonical-JSON serialization. Two manifests
 * are structurally equal iff their canonical JSON serializations match
 * byte-for-byte. This catches tampering even when the digest is forged
 * to match a tampered structure.
 */
export function manifestsAreStructurallyEqual(
  a: ScoringInputManifest,
  b: ScoringInputManifest,
): boolean {
  return canonicalStringify(a) === canonicalStringify(b)
}

export type ManifestMergeResult =
  | { ok: true; mergedResult: Record<string, unknown> }
  | { ok: false; code: 'manifest_shape_invalid' | 'manifest_tamper_forged' | 'manifest_tamper_mismatch' }

/**
 * Compute the merged analysis_result that should be written back when a
 * client PATCHes an existing analysis record.
 *
 *   - If the client OMITS scoringInputManifest and the stored record HAS
 *     one, the stored manifest is preserved as-is.
 *   - If the client OMITS scoringInputManifest and the stored record has
 *     no manifest, the next result is returned unchanged.
 *   - If the client PROVIDES scoringInputManifest and the stored record
 *     has no manifest, this is a forgery attempt: rejected (forged).
 *   - If the client PROVIDES scoringInputManifest that is structurally
 *     equal to the stored one, the next result is returned unchanged
 *     (the client has merely echoed the same immutable record back).
 *   - If the client PROVIDES scoringInputManifest that differs from the
 *     stored one, this is a tampering attempt: rejected (mismatch).
 *
 * The merged result preserves all other analysis-result fields verbatim
 * from the client. This function never alters fields outside the
 * scoringInputManifest scope.
 */
export function preserveStoredManifestOnPatch(
  currentResult: unknown,
  nextResult: Record<string, unknown>,
): ManifestMergeResult {
  const currentManifest = (currentResult as { scoringInputManifest?: unknown } | null | undefined)
    ?.scoringInputManifest
  const nextManifest = nextResult?.scoringInputManifest

  // Case A: client omitted manifest — preserve stored one if any.
  if (nextManifest === undefined) {
    if (currentManifest === undefined) {
      return { ok: true, mergedResult: nextResult }
    }
    return {
      ok: true,
      mergedResult: { ...nextResult, scoringInputManifest: currentManifest },
    }
  }

  // From here on, the client provided a manifest. It must be well-shaped.
  if (!isValidManifestShape(nextManifest)) {
    return { ok: false, code: 'manifest_shape_invalid' }
  }

  // Case B: client provided a manifest but the stored record has none.
  if (currentManifest === undefined || currentManifest === null) {
    return { ok: false, code: 'manifest_tamper_forged' }
  }

  // Both have a manifest — must be structurally equal.
  if (!isValidManifestShape(currentManifest)) {
    // The stored manifest is broken (legacy / corrupted). Refuse to write
    // rather than risk writing a forged manifest that gets accepted as
    // the new "stored" one on a subsequent PATCH.
    return { ok: false, code: 'manifest_tamper_forged' }
  }

  if (!manifestsAreStructurallyEqual(nextManifest, currentManifest)) {
    return { ok: false, code: 'manifest_tamper_mismatch' }
  }

  return { ok: true, mergedResult: nextResult }
}
