import { createHash } from 'node:crypto'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const isHash = (value: string) => /^[a-f0-9]{64}$/.test(value)

export interface OccurrencePatch {
  id: string; decisionId: string; sourceHash: string; graphHash: string
  start: number; end: number; preimage: string; preimageHash: string; replacement: string
}
export interface PatchAuthority {
  decisionId: string; patchId: string; sourceHash: string; graphHash: string
  patchHash: string
  status: string; evidenceHash: string; independentAudit: string
  jointCompatibilityHash: string; authorizedPatchIds: readonly string[]
}
export interface Scenario {
  readonly original: string; readonly text: string; readonly sourceHash: string
  readonly graphHash: string; readonly scenarioHash: string; readonly identity: string
  readonly patchIds: readonly string[]; readonly applied: false
}
export interface CanonicalScoringInput {
  scenarioHash: string; description: string
  materials: readonly { occurrenceId: string; identity: string; massG: number | null }[]
}
export function patchFingerprint(p: OccurrencePatch): string {
  return hash(JSON.stringify([p.id, p.decisionId, p.sourceHash, p.graphHash, p.start, p.end, p.preimage, p.preimageHash, p.replacement]))
}
/** Authorities are trusted internal audit records, never client-submitted grants. */
export function assembleScenario(input: { original: string; sourceHash: string; graphHash: string; patches: readonly OccurrencePatch[]; authorities: readonly PatchAuthority[] }): Scenario {
  const { original, sourceHash, graphHash } = input
  const bytes = Buffer.from(original, 'utf8')
  if (bytes.toString('utf8') !== original || hash(original) !== sourceHash || !isHash(graphHash)) throw new Error('patch_identity')
  const patches = [...input.patches].map(p => ({ ...p })).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
  if (new Set(patches.map(p => p.id)).size !== patches.length || patches.some((p, i) => i > 0 && patches[i - 1].end > p.start)) throw new Error('patch_conflict')
  const patchIds = patches.map(p => p.id).sort()
  let jointHash: string | undefined
  for (const p of patches) {
    if (!isHash(p.id) || !isHash(p.decisionId) || p.sourceHash !== sourceHash || p.graphHash !== graphHash) throw new Error('patch_identity')
    if (!Number.isSafeInteger(p.start) || !Number.isSafeInteger(p.end) || p.start < 0 || p.end <= p.start || p.end > bytes.length || hash(p.preimage) !== p.preimageHash || !bytes.subarray(p.start, p.end).equals(Buffer.from(p.preimage))) throw new Error('patch_preimage')
    const prefix = bytes.subarray(0, p.start).toString('utf8')
    const suffix = bytes.subarray(p.end).toString('utf8')
    if (Buffer.byteLength(prefix) !== p.start || Buffer.byteLength(suffix) !== bytes.length - p.end) throw new Error('patch_preimage')
    // Combining marks also continue tokens; byte boundaries alone are insufficient.
    if (/[\p{L}\p{M}\p{N}_-]$/u.test(prefix) || /^[\p{L}\p{M}\p{N}_-]/u.test(suffix)) throw new Error('patch_substring')
    if (!p.replacement.trim() || p.replacement === p.preimage || /[\r\n\x00-\x1f]/.test(p.replacement) || Buffer.from(p.replacement).toString('utf8') !== p.replacement) throw new Error('patch_replacement')
    const candidates = input.authorities.filter(a => a.patchId === p.id && a.decisionId === p.decisionId)
    if (candidates.length !== 1) throw new Error('patch_authority')
    const a = candidates[0]
    if (a.patchHash !== patchFingerprint(p)) throw new Error('patch_authority')
    if (a.sourceHash !== sourceHash || a.graphHash !== graphHash || a.status !== 'approved-draft-edit' || a.independentAudit !== 'approved' || !isHash(a.evidenceHash) || !isHash(a.jointCompatibilityHash) || JSON.stringify([...a.authorizedPatchIds].sort()) !== JSON.stringify(patchIds) || (jointHash !== undefined && jointHash !== a.jointCompatibilityHash)) throw new Error('patch_authority')
    jointHash = a.jointCompatibilityHash
  }
  const chunks: Buffer[] = []
  let cursor = 0
  for (const p of patches) { chunks.push(bytes.subarray(cursor, p.start), Buffer.from(p.replacement)); cursor = p.end }
  chunks.push(bytes.subarray(cursor))
  const text = Buffer.concat(chunks).toString('utf8')
  const scenarioHash = hash(text)
  return Object.freeze({ original, text, sourceHash, graphHash, scenarioHash, identity: hash(JSON.stringify({ version: 'occurrence-v1', sourceHash, graphHash, scenarioHash, patches, jointHash })), patchIds: Object.freeze(patchIds), applied: false as const })
}
/**
 * Internal trusted adapter: accept only trusted assembled scenarios and supplied
 * material conversions. This does not authenticate scenario provenance, prove
 * graph/material completeness, or detect stale positive masses. Null conversion
 * is unavailable; the injected scorer supplies calculations, not this adapter.
 */
export function bindScore(scenario: Scenario, input: CanonicalScoringInput, version: string, scorer: (input: CanonicalScoringInput) => number) {
  if (hash(scenario.text) !== scenario.scenarioHash || input.scenarioHash !== scenario.scenarioHash || input.description !== scenario.text || !version.trim()) throw new Error('score_identity')
  const frozen = Object.freeze({ ...input, materials: Object.freeze(input.materials.map(m => Object.freeze({ ...m }))) })
  const inputHash = hash(JSON.stringify(frozen))
  const binding = { scenarioHash: scenario.scenarioHash, scenarioIdentity: scenario.identity, inputHash, scorerVersion: version }
  if (new Set(frozen.materials.map(m => m.occurrenceId)).size !== frozen.materials.length || frozen.materials.some(m => !isHash(m.occurrenceId) || !m.identity.trim())) throw new Error('score_material_identity')
  if (!frozen.materials.length || frozen.materials.some(m => m.massG === null || !Number.isFinite(m.massG) || m.massG < 0)) return Object.freeze({ ...binding, state: 'unavailable' as const, reason: 'conversion_unavailable' })
  try {
    const score = scorer(frozen)
    if (!Number.isFinite(score)) throw new Error('score_invalid')
    return Object.freeze({ ...binding, state: 'scored' as const, score })
  } catch { return Object.freeze({ ...binding, state: 'unavailable' as const, reason: 'scorer_failed' }) }
}
