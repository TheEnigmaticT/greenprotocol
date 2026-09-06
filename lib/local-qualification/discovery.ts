import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Filesystem authority lives only in the reviewed helper. No PATH/env fallback.
const PYTHON = '/Library/Developer/CommandLineTools/usr/bin/python3'
const HELPER = fileURLToPath(new URL('./discovery_boundary.py', import.meta.url))
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_FILES = 2048
const MAX_TRANSPORT_BYTES = MAX_TOTAL_BYTES + MAX_FILES * 6 + 12
const CHECKS = ['SYMLINK_COMPONENT', 'NON_DIRECTORY_COMPONENT', 'NON_REGULAR_OR_MULTILINK', 'OPEN_IDENTITY_CHANGED', 'FILE_CHANGED', 'READ_LENGTH_CHANGED', 'EXPECTED_DIRECTORY', 'DIRECTORY_CHANGED', 'PATH_MISSING', 'ACCESS_DENIED', 'FILESYSTEM_ERROR'] as const
const MAX_FILE_BYTES = 8 * 1024 * 1024
const SAFE_KEYS = new Set(['cases', 'results', 'input', 'inputs', 'output', 'outputs', 'protocolText', 'protocol_text', 'sourceText', 'source_text', 'procedureText', 'procedure_text', 'model', 'modelId', 'model_id', 'split', 'cohort', 'eligibility', 'evidenceByAlternative', 'quote', 'context', 'usage', 'cost', 'costUsd', 'cost_usd', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'calibration', 'holdout', 'metadata', 'records', 'runs', 'status'])
const SOURCE_KEYS = new Set(['protocolText', 'protocol_text', 'sourceText', 'source_text', 'procedureText', 'procedure_text'])
const MODEL_KEYS = new Set(['model', 'modelId', 'model_id'])
// Metadata recognition only: bounded versions, numeric sizes, fixed variant tokens.
// This does NOT approve a model for execution or assert it exists in a catalog.
const MODEL_ID = /^(?:qwen\/qwen[0-9]{1,2}(?:\.[0-9]{1,2})?(?:-(?:[0-9]{1,4}b|a[0-9]{1,4}b|[0-9]{4}|coder|next|instruct|thinking|plus|flash|max)){0,6}|google\/gemma-[0-9]{1,2}(?:-(?:e?[0-9]{1,3}b|it|instruct)){1,3})(?::free)?$/i
const CODES = new Set(['DISCOVERY_REVIEW_REQUIRED', 'DISCOVERY_UNSAFE_PATH', 'DISCOVERY_INVALID_JSON', 'DISCOVERY_LIMIT'])
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
function fail(code: string): never { throw new Error(code) }
type UnsafeCheck = 'SYMLINK_COMPONENT' | 'NON_DIRECTORY_COMPONENT' | 'NON_REGULAR_OR_MULTILINK' | 'OPEN_IDENTITY_CHANGED' | 'FILE_CHANGED' | 'READ_LENGTH_CHANGED' | 'EXPECTED_DIRECTORY' | 'DIRECTORY_CHANGED' | 'PATH_MISSING' | 'ACCESS_DENIED' | 'FILESYSTEM_ERROR'
class DiscoveryPathError extends Error {
  constructor(readonly check: UnsafeCheck) { super('DISCOVERY_UNSAFE_PATH') }
}
function unsafe(check: UnsafeCheck): never { throw new DiscoveryPathError(check) }
interface Field { path: string; type: string; count: number }
interface Source { sha256: string; count: number; paths: string[] }
interface Model { family: 'Qwen' | 'Gemma'; modelId?: string; sha256: string; count: number }
export interface DiscoverySummary {
  version: 1
  rootFileCounts: number[]
  fileCount: number
  totalBytes: number
  artifactHashes: string[]
  schema: Field[]
  sourceOccurrenceCount: number
  distinctSourceCount: number
  sources: Source[]
  models: Model[]
  cohortEvidence: { calibration: number; previousHoldout: number; unclassified: number }
}
function documents(): { rootIndex: number; bytes: Buffer }[] {
  // stderr capture cap is zero: discard it in the OS, never buffer/forward it.
  // Diagnostics travel only as fixed binary enum frames on the private pipe.
  const child = spawnSync(PYTHON, ['-I', '-S', HELPER], {
    shell: false, env: {} as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: MAX_TRANSPORT_BYTES,
  })
  if (child.error || child.signal || !Buffer.isBuffer(child.stdout) || child.stdout.length > MAX_TRANSPORT_BYTES) unsafe('FILESYSTEM_ERROR')
  const wire = child.stdout
  const docs: { rootIndex: number; bytes: Buffer }[] = []
  let offset = 0, root = 0, total = 0
  const need = (n: number) => { if (offset + n > wire.length) unsafe('FILESYSTEM_ERROR') }
  // Capability failure can precede magic; no data can precede it.
  if (wire.length === 3 && wire[0] === 69 && child.status === 1) offset = 0
  else {
    need(4)
    if (!wire.subarray(0, 4).equals(Buffer.from('DSC1'))) unsafe('FILESYSTEM_ERROR')
    offset = 4
  }
  while (offset < wire.length) {
    const tag = wire[offset++]
    if (tag === 69) {
      need(2)
      const code = wire[offset++], check = wire[offset++]
      if (offset !== wire.length || child.status !== 1 || code > 1 || check >= CHECKS.length) unsafe('FILESYSTEM_ERROR')
      if (code === 1) fail('DISCOVERY_LIMIT')
      unsafe(CHECKS[check])
    } else if (tag === 68) {
      need(5)
      const rootIndex = wire[offset++], length = wire.readUInt32BE(offset); offset += 4
      if (rootIndex !== root || root >= 2) unsafe('FILESYSTEM_ERROR')
      if (length === 0 || length > MAX_FILE_BYTES || docs.length >= MAX_FILES || total + length > MAX_TOTAL_BYTES) fail('DISCOVERY_LIMIT')
      need(length)
      docs.push({ rootIndex, bytes: wire.subarray(offset, offset + length) })
      total += length; offset += length
    } else if (tag === 82) {
      need(1)
      if (root >= 2 || wire[offset++] !== root++) unsafe('FILESYSTEM_ERROR')
    } else if (tag === 90) {
      if (root !== 2 || offset !== wire.length || child.status !== 0) unsafe('FILESYSTEM_ERROR')
      return docs
    } else unsafe('FILESYSTEM_ERROR')
  }
  unsafe('FILESYSTEM_ERROR')
}

/** Offline metadata only. A true flag records review, it cannot perform review.
 * No protocol values, filenames, arbitrary keys, or arbitrary model IDs escape.
 * Cohort counts are unvalidated label occurrences, not assigned source splits.
 */
export function discoverLocalCorpus(reviewApproved: boolean): DiscoverySummary {
  try {
    if (reviewApproved !== true) fail('DISCOVERY_REVIEW_REQUIRED')
    const result: DiscoverySummary = { version: 1, rootFileCounts: [0, 0], fileCount: 0, totalBytes: 0, artifactHashes: [], schema: [], sourceOccurrenceCount: 0, distinctSourceCount: 0, sources: [], models: [], cohortEvidence: { calibration: 0, previousHoldout: 0, unclassified: 0 } }
    const fields = new Map<string, Field>()
    const sources = new Map<string, Source>()
    const models = new Map<string, Model>()
    let nodes = 0
    function visit(value: unknown, path: string, key: string, depth: number) {
      if (++nodes > 1_000_000 || depth > 32) fail('DISCOVERY_LIMIT')
      const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
      const id = path + ':' + type
      const field = fields.get(id) ?? { path, type, count: 0 }
      field.count++; fields.set(id, field)
      if (fields.size > 10_000) fail('DISCOVERY_LIMIT')
      if (typeof value === 'string') {
        if (SOURCE_KEYS.has(key) && value.trim()) {
          if (Buffer.from(value, 'utf8').toString('utf8') !== value) fail('DISCOVERY_INVALID_JSON')
          const sha256 = digest(value)
          const source = sources.get(sha256) ?? { sha256, count: 0, paths: [] }
          source.count++; result.sourceOccurrenceCount++
          if (!source.paths.includes(path)) source.paths.push(path)
          sources.set(sha256, source)
          if (sources.size > 20_000) fail('DISCOVERY_LIMIT')
        }
        if (MODEL_KEYS.has(key)) {
          const family = /^(?:qwen\/|Qwen\/|qwen[0-9-])/i.test(value) ? 'Qwen' : /^(?:google\/gemma-|gemma-)/i.test(value) ? 'Gemma' : null
          if (family) {
            const sha256 = digest(value)
            const model = models.get(sha256) ?? { family, sha256, count: 0, ...(value.length <= 128 && MODEL_ID.test(value) ? { modelId: value } : {}) }
            model.count++; models.set(sha256, model)
            if (models.size > 1024) fail('DISCOVERY_LIMIT')
          }
        }
        if (key === 'split' || key === 'cohort') {
          if (value === 'calibration') result.cohortEvidence.calibration++
          if (value === 'previous-holdout') result.cohortEvidence.previousHoldout++
          if (value === 'unclassified') result.cohortEvidence.unclassified++
        }
      } else if (Array.isArray(value)) {
        for (const item of value) visit(item, path + '[]', '', depth + 1)
      } else if (value !== null && typeof value === 'object') {
        for (const [child, item] of Object.entries(value)) visit(item, path + '.' + (SAFE_KEYS.has(child) ? child : '*'), child, depth + 1)
      }
    }
    for (const { rootIndex, bytes } of documents()) {
      let value: unknown
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { fail('DISCOVERY_INVALID_JSON') }
      if (value === null || typeof value !== 'object') fail('DISCOVERY_INVALID_JSON')
      result.fileCount++
      result.totalBytes += bytes.length
      result.rootFileCounts[rootIndex]++
      result.artifactHashes.push(digest(bytes))
      visit(value, '$', '', 0)
    }
    result.artifactHashes.sort()
    result.schema = [...fields.values()].sort((a, b) => a.path.localeCompare(b.path) || a.type.localeCompare(b.type))
    result.sources = [...sources.values()].map(s => ({ ...s, paths: s.paths.sort() })).sort((a, b) => a.sha256.localeCompare(b.sha256))
    result.distinctSourceCount = result.sources.length
    result.models = [...models.values()].sort((a, b) => a.sha256.localeCompare(b.sha256))
    return result
  } catch (error) {
    if (error instanceof DiscoveryPathError) throw new DiscoveryPathError(error.check)
    if (error instanceof Error && CODES.has(error.message)) throw new Error(error.message)
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
    unsafe(code === 'ENOENT' ? 'PATH_MISSING' : code === 'EACCES' || code === 'EPERM' ? 'ACCESS_DENIED' : 'FILESYSTEM_ERROR')
  }
}
