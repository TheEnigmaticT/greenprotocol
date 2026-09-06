import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { dirname, join, parse, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Never derive authority from cwd, argv, env, or a caller-supplied root.
// This fixed /tmp/ subtree is ignored by this repository's .gitignore.
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PRIVATE_ROOT = join(REPOSITORY_ROOT, 'tmp/local-qualification/corpus')
const MAX_BYTES = 8 * 1024 * 1024
const SHA256 = /^[a-f0-9]{64}$/
export type CorpusSplit = 'calibration' | 'previous-holdout' | 'unclassified'
export interface CorpusManifest {
  /** Set only after independent review; this flag is not itself that review. */
  reviewApproved: boolean
  artifacts: Array<{ filename: string; sha256: string; sources: Array<{ sha256: string; split: CorpusSplit }> }>
}
export interface CorpusCase {
  sourceHash: string
  /** Private, in-memory execution input. Never log or serialize this object. */
  protocolText: string
  split: CorpusSplit
  eligibilityCount: number
  evidenceExcerptCount: number
}
export interface CorpusSummary {
  artifactCount: number
  rawCaseCount: number
  distinctSourceCount: number
  duplicateCount: number
  calibrationCount: number
  previousHoldoutCount: number
  unclassifiedCount: number
}
function fail(code: string): never { throw new Error(code) }
const digest = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function validSplit(value: unknown): value is CorpusSplit {
  return value === 'calibration' || value === 'previous-holdout' || value === 'unclassified'
}
function validateManifest(value: CorpusManifest): void {
  if (!object(value) || value.reviewApproved !== true) fail('CORPUS_REVIEW_REQUIRED')
  if (!Array.isArray(value.artifacts) || !value.artifacts.length || value.artifacts.length > 32) fail('CORPUS_INVALID_MANIFEST')
  const files = new Set<string>()
  const splits = new Map<string, CorpusSplit>()
  for (const artifact of value.artifacts) {
    if (!object(artifact) || typeof artifact.filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}\.json$/.test(artifact.filename) || typeof artifact.sha256 !== 'string' || !SHA256.test(artifact.sha256) || files.has(artifact.filename) || !Array.isArray(artifact.sources) || !artifact.sources.length || artifact.sources.length > 1000) fail('CORPUS_INVALID_MANIFEST')
    files.add(artifact.filename)
    const local = new Set<string>()
    for (const source of artifact.sources) {
      if (!object(source) || typeof source.sha256 !== 'string' || !SHA256.test(source.sha256) || !validSplit(source.split) || local.has(source.sha256) || (splits.has(source.sha256) && splits.get(source.sha256) !== source.split)) fail('CORPUS_INVALID_MANIFEST')
      local.add(source.sha256)
      splits.set(source.sha256, source.split)
    }
  }
}
async function checkPath(path: string): Promise<void> {
  const rel = relative(PRIVATE_ROOT, path)
  if (rel.startsWith('..') || rel.includes('/') || rel.includes('\\')) fail('CORPUS_UNSAFE_PATH')
  let cursor = parse(path).root
  for (const component of path.slice(cursor.length).split('/')) {
    cursor = join(cursor, component)
    const info = await lstat(cursor)
    if (info.isSymbolicLink()) fail('CORPUS_UNSAFE_PATH')
    if (cursor === path) {
      if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) fail('CORPUS_UNSAFE_PATH')
    } else if (!info.isDirectory()) fail('CORPUS_UNSAFE_PATH')
    if ([join(REPOSITORY_ROOT, 'tmp'), dirname(PRIVATE_ROOT), PRIVATE_ROOT].includes(cursor) && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())) fail('CORPUS_UNSAFE_PATH')
  }
}
async function readApproved(filename: string, expectedHash: string): Promise<unknown> {
  const path = join(PRIVATE_ROOT, filename)
  await checkPath(path)
  const before = await lstat(path)
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await fd.stat()
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) fail('CORPUS_UNSAFE_PATH')
    if (stat.size <= 0 || stat.size > MAX_BYTES) fail('CORPUS_INVALID_DATA')
    // A fixed-size read cannot allocate an unbounded buffer if the file grows.
    const bytes = Buffer.alloc(stat.size + 1)
    let count = 0
    while (count < bytes.length) {
      const result = await fd.read(bytes, count, bytes.length - count, count)
      if (!result.bytesRead) break
      count += result.bytesRead
    }
    if (count !== stat.size) fail('CORPUS_INVALID_DATA')
    await checkPath(path)
    const after = await lstat(path)
    if (after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) fail('CORPUS_UNSAFE_PATH')
    const content = bytes.subarray(0, count)
    if (digest(content) !== expectedHash) fail('CORPUS_DIGEST_MISMATCH')
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)) as unknown } catch { fail('CORPUS_INVALID_DATA') }
  } finally { await fd.close() }
}

/** Read-only and offline. No imports of production clients or provider code.
 * Supports documented pilot INPUTS only, not arbitrary historical result shapes.
 * Unknown/private fields are discarded; evidence counts are not evidence approval.
 */
export async function loadApprovedCorpus(manifest: CorpusManifest): Promise<{ cases: CorpusCase[]; summary: CorpusSummary }> {
  try {
    validateManifest(manifest)
    // Snapshot only validated primitives; callers cannot change authorization
    // while filesystem reads are suspended at an await.
    const artifacts = manifest.artifacts.map(artifact => ({ filename: artifact.filename, sha256: artifact.sha256, sources: artifact.sources.map(source => ({ sha256: source.sha256, split: source.split })) }))
    const unique = new Map<string, CorpusCase>()
    let rawCaseCount = 0
    for (const artifact of artifacts) {
      const data = await readApproved(artifact.filename, artifact.sha256)
      if (!object(data) || !Array.isArray(data.cases) || !data.cases.length || data.cases.length > 1000) fail('CORPUS_INVALID_DATA')
      const approved = new Map(artifact.sources.map(source => [source.sha256, source.split]))
      const seen = new Set<string>()
      for (const item of data.cases) {
        if (!object(item) || typeof item.protocolText !== 'string' || !item.protocolText.trim() || Buffer.byteLength(item.protocolText, 'utf8') > 1024 * 1024 || !Array.isArray(item.eligibility) || !object(item.evidenceByAlternative)) fail('CORPUS_INVALID_DATA')
        if (Buffer.from(item.protocolText, 'utf8').toString('utf8') !== item.protocolText) fail('CORPUS_INVALID_DATA')
        const sourceHash = digest(item.protocolText)
        const split = approved.get(sourceHash)
        if (!split) fail('CORPUS_SOURCE_NOT_APPROVED')
        let evidenceExcerptCount = 0
        for (const excerpts of Object.values(item.evidenceByAlternative)) {
          if (!Array.isArray(excerpts) || !excerpts.every(excerpt => object(excerpt) && typeof excerpt.quote === 'string' && typeof excerpt.context === 'string')) fail('CORPUS_INVALID_DATA')
          evidenceExcerptCount += excerpts.length
        }
        seen.add(sourceHash)
        rawCaseCount++
        if (!unique.has(sourceHash)) unique.set(sourceHash, { sourceHash, protocolText: item.protocolText, split, eligibilityCount: item.eligibility.length, evidenceExcerptCount })
      }
      if (seen.size !== approved.size) fail('CORPUS_SOURCE_NOT_APPROVED')
    }
    const cases = [...unique.values()]
    return { cases, summary: {
      artifactCount: artifacts.length, rawCaseCount, distinctSourceCount: cases.length,
      duplicateCount: rawCaseCount - cases.length,
      calibrationCount: cases.filter(item => item.split === 'calibration').length,
      previousHoldoutCount: cases.filter(item => item.split === 'previous-holdout').length,
      unclassifiedCount: cases.filter(item => item.split === 'unclassified').length,
    } }
  } catch (error) {
    // Never propagate fs paths, JSON excerpts, source content, or nested causes.
    const allowed = new Set(['CORPUS_REVIEW_REQUIRED', 'CORPUS_INVALID_MANIFEST', 'CORPUS_UNSAFE_PATH', 'CORPUS_INVALID_DATA', 'CORPUS_DIGEST_MISMATCH', 'CORPUS_SOURCE_NOT_APPROVED'])
    throw new Error(error instanceof Error && allowed.has(error.message) ? error.message : 'CORPUS_UNSAFE_PATH')
  }
}
