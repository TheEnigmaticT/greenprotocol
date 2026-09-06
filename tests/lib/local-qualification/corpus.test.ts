import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
let sandbox: string
let root: string
let load: typeof import('../../../lib/local-qualification/corpus').loadApprovedCorpus
const protocol = 'SYNTHETIC ONLY: Mix water.'
const fixture = () => ({ cases: [{ caseId: 'private-id', protocolText: protocol, eligibility: [{}], evidenceByAlternative: { water: [{ sourceId: 'private-source', quote: 'synthetic', context: 'synthetic' }] }, baselineOutput: 'private-baseline', userId: 'private-user' }] })
function arrange(data: unknown = fixture()) {
  const text = JSON.stringify(data)
  writeFileSync(join(root, 'fixture.json'), text, { mode: 0o600 })
  return { reviewApproved: true as const, artifacts: [{ filename: 'fixture.json', sha256: hash(text), sources: [{ sha256: hash(protocol), split: 'calibration' as const }] }] }
}
beforeEach(async () => {
  sandbox = mkdtempSync(join(realpathSync(tmpdir()), 'corpus-synthetic-'))
  root = join(sandbox, 'tmp/local-qualification/corpus')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  vi.resetModules()
  vi.doMock('node:url', () => ({ fileURLToPath: () => join(sandbox, 'lib/local-qualification/corpus.ts') }))
  load = (await import('../../../lib/local-qualification/corpus')).loadApprovedCorpus
})
afterEach(() => { vi.doUnmock('node:url'); rmSync(sandbox, { recursive: true, force: true }) })

describe('review-gated offline corpus loader (synthetic only)', () => {
  it('retains only protocol and minimum metadata, suppressing identifiers and outputs', async () => {
    const result = await load(arrange())
    expect(result.cases).toHaveLength(1)
    expect(result.cases[0]).toEqual({ sourceHash: hash(protocol), protocolText: protocol, split: 'calibration', eligibilityCount: 1, evidenceExcerptCount: 1 })
    expect(result.summary).toEqual({ artifactCount: 1, rawCaseCount: 1, distinctSourceCount: 1, duplicateCount: 0, calibrationCount: 1, previousHoldoutCount: 0, unclassifiedCount: 0 })
  })
  it('rejects missing independent review approval before reading', async () => {
    await expect(load({ ...arrange(), reviewApproved: false } as never)).rejects.toThrow('CORPUS_REVIEW_REQUIRED')
  })
  it('requires a nonempty approved artifact and source hash allowlist', async () => {
    await expect(load({ reviewApproved: true, artifacts: [] })).rejects.toThrow('CORPUS_INVALID_MANIFEST')
    const manifest = arrange(); manifest.artifacts[0].sources = []
    await expect(load(manifest)).rejects.toThrow('CORPUS_INVALID_MANIFEST')
  })
  it.each(['../fixture.json', '/tmp/fixture.json', 'folder/fixture.json', '.env.json', 'fixture.JSON'])('rejects unsafe filename %s', async filename => {
    const manifest = arrange(); manifest.artifacts[0].filename = filename
    await expect(load(manifest)).rejects.toThrow('CORPUS_INVALID_MANIFEST')
  })
  it('rejects artifact digest mismatch', async () => {
    const manifest = arrange(); manifest.artifacts[0].sha256 = '0'.repeat(64)
    await expect(load(manifest)).rejects.toThrow('CORPUS_DIGEST_MISMATCH')
  })
  it('rejects unapproved source digest', async () => {
    const manifest = arrange(); manifest.artifacts[0].sources[0].sha256 = '0'.repeat(64)
    await expect(load(manifest)).rejects.toThrow('CORPUS_SOURCE_NOT_APPROVED')
  })
  it('rejects world-readable files', async () => {
    const manifest = arrange(); chmodSync(join(root, 'fixture.json'), 0o644)
    await expect(load(manifest)).rejects.toThrow('CORPUS_UNSAFE_PATH')
  })
  it('rejects world-readable private root', async () => {
    const manifest = arrange(); chmodSync(root, 0o755)
    await expect(load(manifest)).rejects.toThrow('CORPUS_UNSAFE_PATH')
  })
  it('rejects leaf symlinks', async () => {
    const manifest = arrange(); rmSync(join(root, 'fixture.json')); writeFileSync(join(sandbox, 'outside.json'), '{}'); symlinkSync(join(sandbox, 'outside.json'), join(root, 'fixture.json'))
    await expect(load(manifest)).rejects.toThrow('CORPUS_UNSAFE_PATH')
  })
  it('rejects intermediate symlinks', async () => {
    const manifest = arrange(); rmSync(join(sandbox, 'tmp'), { recursive: true }); mkdirSync(join(sandbox, 'outside')); symlinkSync(join(sandbox, 'outside'), join(sandbox, 'tmp'))
    await expect(load(manifest)).rejects.toThrow('CORPUS_UNSAFE_PATH')
  })
  it('deduplicates exact raw text while preserving raw-newline distinctions', async () => {
    const data = fixture(); data.cases.push({ ...data.cases[0] }); const manifest = arrange(data)
    const result = await load(manifest)
    expect(result.summary.duplicateCount).toBe(1); expect(result.summary.distinctSourceCount).toBe(1); expect(result.cases).toHaveLength(1)
  })
  it('rejects conflicting calibration and previous holdout annotations', async () => {
    const manifest = arrange(); manifest.artifacts[0].sources.push({ sha256: hash(protocol), split: 'previous-holdout' } as never)
    await expect(load(manifest)).rejects.toThrow('CORPUS_INVALID_MANIFEST')
  })
  it('sanitizes malformed JSON errors without leaking raw input or paths', async () => {
    const manifest = arrange(); const text = '{ private-protocol-secret'; writeFileSync(join(root, 'fixture.json'), text); manifest.artifacts[0].sha256 = hash(text)
    await expect(load(manifest)).rejects.toThrow(/^CORPUS_INVALID_DATA$/)
  })
  it('rejects group-accessible private ancestors', async () => {
    const manifest = arrange(); chmodSync(join(sandbox, 'tmp/local-qualification'), 0o770)
    await expect(load(manifest)).rejects.toThrow('CORPUS_UNSAFE_PATH')
  })
  it('snapshots authorization before the first async boundary', async () => {
    const manifest = arrange(); const pending = load(manifest)
    manifest.artifacts[0].sha256 = '0'.repeat(64)
    manifest.artifacts[0].sources[0].sha256 = '0'.repeat(64)
    expect((await pending).summary.distinctSourceCount).toBe(1)
  })
  it('does not hash unpaired surrogates as replacement characters', async () => {
    const data = fixture(); data.cases[0].protocolText = '\ud800'
    const manifest = arrange(data); manifest.artifacts[0].sources[0].sha256 = hash('\ud800')
    await expect(load(manifest)).rejects.toThrow('CORPUS_INVALID_DATA')
  })
  it('keeps LF and CRLF as distinct raw-source hashes', async () => {
    const data = fixture(); data.cases[0].protocolText = 'SYNTHETIC\nONLY'
    data.cases.push({ ...data.cases[0], protocolText: 'SYNTHETIC\r\nONLY' })
    const manifest = arrange(data); manifest.artifacts[0].sources = data.cases.map(item => ({ sha256: hash(item.protocolText), split: 'calibration' }))
    const result = await load(manifest)
    expect(result.summary.distinctSourceCount).toBe(2); expect(result.summary.duplicateCount).toBe(0)
  })
  it('rejects unsupported schema instead of guessing baseline fields', async () => {
    await expect(load(arrange({ results: [{ protocolText: protocol }] }))).rejects.toThrow('CORPUS_INVALID_DATA')
  })
})
