import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const roots = ['/private/tmp/greenchemistry-ai-decomposed-benchmark/tmp', '/Users/ct-mac-mini/dev/greenchemistry-ai/tmp']
let sandbox: string | undefined
async function fixture() {
  sandbox = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'discovery-synthetic-'))
  const mapped = roots.map((_, i) => join(sandbox!, String(i)))
  mapped.forEach(p => fs.mkdirSync(join(p, 'synthetic-benchmark'), { recursive: true }))
  vi.resetModules()
  vi.doMock('node:child_process', () => ({ spawnSync: (command: string, _args: string[], options: Parameters<typeof spawnSync>[2]) =>
    spawnSync(command, ['-I', '-S', new URL('./discovery_test_driver.py', import.meta.url).pathname, ...mapped], options),
  }))
  return { root: join(mapped[0], 'synthetic-benchmark'), api: await import('../../../lib/local-qualification/discovery') }
}
afterEach(() => { vi.doUnmock('node:child_process'); vi.resetModules(); if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true }); sandbox = undefined })

describe('discovery CLI diagnostics: mocked utility only', () => {
  const codes = ['DISCOVERY_UNSAFE_PATH', 'DISCOVERY_INVALID_JSON', 'DISCOVERY_LIMIT', 'DISCOVERY_REVIEW_REQUIRED']
  const cases = [
    ...['SYMLINK_COMPONENT', 'NON_DIRECTORY_COMPONENT', 'NON_REGULAR_OR_MULTILINK', 'OPEN_IDENTITY_CHANGED', 'FILE_CHANGED', 'READ_LENGTH_CHANGED', 'EXPECTED_DIRECTORY', 'DIRECTORY_CHANGED', 'PATH_MISSING', 'ACCESS_DENIED', 'FILESYSTEM_ERROR'].map(check => ({ error: Object.assign(new Error('DISCOVERY_UNSAFE_PATH'), { check }), expected: 'DISCOVERY_UNSAFE_PATH:' + check })),
    ...['PRIVATE-SENTINEL', 'SYMLINK_COMPONENT\nPRIVATE-SENTINEL', 'SYMLINK_COMPONENT '].map(check => ({ error: Object.assign(new Error('DISCOVERY_UNSAFE_PATH'), { check }), expected: 'DISCOVERY_UNSAFE_PATH' })),
    ...codes.map(code => ({ error: new Error(code, { cause: new Error('/SYNTHETIC-PRIVATE/source credential') }), expected: code })),
    ...[
      new Error('/SYNTHETIC-PRIVATE/source credential'),
      new Error('DISCOVERY_LIMIT\n/SYNTHETIC-PRIVATE/source'),
      new Error('DISCOVERY_LIMIT '),
      new Error('EACCES'),
      new Error('wrapper', { cause: new Error('DISCOVERY_LIMIT') }),
      { message: 'DISCOVERY_LIMIT', path: '/SYNTHETIC-PRIVATE/source' },
      'DISCOVERY_LIMIT', null, undefined,
    ].map(error => ({ error, expected: 'DISCOVERY_FAILED' })),
  ]
  it.each(cases)('emits only the exact fixed diagnostic $expected (case %#)', async ({ error, expected }) => {
    const argv = process.argv
    const exitCode = process.exitCode
    const discover = vi.fn(() => { throw error })
    vi.resetModules()
    vi.doMock('../../../lib/local-qualification/discovery', () => ({ discoverLocalCorpus: discover }))
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    process.argv = ['node', 'synthetic-cli', '--review-approved']
    try {
      await import('../../../scripts/benchmarks/discover-local-corpus')
      expect(discover).toHaveBeenCalledExactlyOnceWith(true)
      expect(process.exitCode).toBe(1)
      expect(stdout).not.toHaveBeenCalled()
      expect(stderr).toHaveBeenCalledExactlyOnceWith(expected + '\n')
    } finally {
      process.argv = argv
      process.exitCode = exitCode
      stdout.mockRestore()
      stderr.mockRestore()
      vi.doUnmock('../../../lib/local-qualification/discovery')
      vi.resetModules()
    }
  })
})

describe('private discovery: synthetic fixtures only', () => {
  it.each([{ args: [] }, { args: ['--review-approved', '--root', '/PRIVATE-SENTINEL'] }])('CLI fails closed without exact reviewed invocation', ({ args }) => {
    const result = spawnSync('./node_modules/.bin/tsx', ['scripts/benchmarks/discover-local-corpus.ts', ...args], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('DISCOVERY_REVIEW_REQUIRED\n')
  })
  it('bounds the file count', async () => {
    const { root, api } = await fixture()
    for (let i = 0; i < 2049; i++) fs.writeFileSync(join(root, String(i) + '.json'), '{}')
    expect(() => api.discoverLocalCorpus(true)).toThrow(/^DISCOVERY_LIMIT$/)
  })
  it('bounds directory depth', async () => {
    const { root, api } = await fixture()
    fs.mkdirSync(join(root, ...Array(17).fill('nested')), { recursive: true })
    expect(() => api.discoverLocalCorpus(true)).toThrow(/^DISCOVERY_LIMIT$/)
  })
  it('rejects empty files', async () => {
    const { root, api } = await fixture(); fs.writeFileSync(join(root, 'empty.json'), '')
    expect(() => api.discoverLocalCorpus(true)).toThrow(/^DISCOVERY_LIMIT$/)
  })
  it('reports exact Qwen/Gemma IDs only within a bounded token grammar', async () => {
    const { root, api } = await fixture()
    fs.writeFileSync(join(root, 'models.json'), JSON.stringify({ runs: [
      { model: 'qwen/qwen3.5-397b-a17b' }, { modelId: 'google/gemma-4-27b-it' },
      { model: 'qwen/qwen3-private-secret' }, { model: 'google/gemma-private-secret' },
    ] }))
    const result = api.discoverLocalCorpus(true)
    expect(result.models.map(m => m.modelId).filter(Boolean).sort()).toEqual(['google/gemma-4-27b-it', 'qwen/qwen3.5-397b-a17b'])
    expect(JSON.stringify(result)).not.toContain('private-secret')
  })
  it('requires review before filesystem operations', async () => {
    const { discoverLocalCorpus } = await import('../../../lib/local-qualification/discovery')
    expect(() => discoverLocalCorpus(false)).toThrow(/^DISCOVERY_REVIEW_REQUIRED$/)
  })
  it('emits only fixed schema paths, hashes, counts and approved model values', async () => {
    const { root, api } = await fixture()
    fs.writeFileSync(join(root, 'private-filename.json'), JSON.stringify({ cases: [{ protocolText: 'SYNTHETIC PRIVATE', split: 'calibration', model: 'google/gemma-4-31b-it', privateIdentifier: { protocolText: 'SYNTHETIC OTHER', secretKey: 'credential' } }, { protocolText: 'SYNTHETIC PRIVATE', split: 'arbitrary-private-split', model: 'qwen/private-secret-model' }], userId: 'PRIVATE-ID' }))
    const result = api.discoverLocalCorpus(true)
    expect(result.fileCount).toBe(1)
    expect(result.sourceOccurrenceCount).toBe(3)
    expect(result.distinctSourceCount).toBe(2)
    expect(result.sources.map(s => s.sha256)).toContain(hash('SYNTHETIC PRIVATE'))
    expect(result.schema.some(s => s.path === '$.cases[].*.protocolText')).toBe(true)
    expect(result.models).toContainEqual({ family: 'Gemma', modelId: 'google/gemma-4-31b-it', sha256: hash('google/gemma-4-31b-it'), count: 1 })
    expect(result.cohortEvidence).toEqual({ calibration: 1, previousHoldout: 0, unclassified: 0 })
    const output = JSON.stringify(result)
    for (const secret of ['SYNTHETIC', 'privateIdentifier', 'secretKey', 'credential', 'PRIVATE-ID', 'private-filename', 'arbitrary-private-split', 'private-secret-model', sandbox!]) expect(output).not.toContain(secret)
  })
  it.each(['{secret-invalid', 'null', '42'])('rejects malformed or scalar documents safely', async content => {
    const { root, api } = await fixture(); fs.writeFileSync(join(root, 'bad.json'), content)
    expect(() => api.discoverLocalCorpus(true)).toThrow(/^DISCOVERY_INVALID_JSON$/)
  })
  it('rejects invalid UTF-8', async () => {
    const { root, api } = await fixture(); fs.writeFileSync(join(root, 'bad.json'), Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]))
    expect(() => api.discoverLocalCorpus(true)).toThrow(/^DISCOVERY_INVALID_JSON$/)
  })
  it('rejects oversized files without returning partial results', async () => {
    const { root, api } = await fixture(); fs.writeFileSync(join(root, 'large.json'), Buffer.alloc(8 * 1024 * 1024 + 1))
    expect(() => api.discoverLocalCorpus(true)).toThrow(/^DISCOVERY_LIMIT$/)
  })
  it('rejects leaf symlinks', async () => {
    const { root, api } = await fixture(); fs.writeFileSync(join(sandbox!, 'outside.json'), '{}'); fs.symlinkSync(join(sandbox!, 'outside.json'), join(root, 'linked.json'))
    expect(() => api.discoverLocalCorpus(true)).toThrow(/^DISCOVERY_UNSAFE_PATH$/)
  })
  it('rejects intermediate symlinks', async () => {
    const { root, api } = await fixture(); fs.mkdirSync(join(sandbox!, 'outside')); fs.symlinkSync(join(sandbox!, 'outside'), join(root, 'nested'))
    expect(() => api.discoverLocalCorpus(true)).toThrow(/^DISCOVERY_UNSAFE_PATH$/)
  })
  it('rejects hardlinks', async () => {
    const { root, api } = await fixture(); fs.writeFileSync(join(root, 'first.json'), '{}'); fs.linkSync(join(root, 'first.json'), join(root, 'second.json'))
    expect(() => api.discoverLocalCorpus(true)).toThrow(/^DISCOVERY_UNSAFE_PATH$/)
  })
  it('does not inspect nonbenchmark directories', async () => {
    const { root, api } = await fixture(); fs.mkdirSync(join(root, '../unrelated')); fs.writeFileSync(join(root, '../unrelated/private.json'), 'INVALID')
    expect(api.discoverLocalCorpus(true).fileCount).toBe(0)
  })
  it('bounds JSON traversal depth', async () => {
    const { root, api } = await fixture(); fs.writeFileSync(join(root, 'deep.json'), '['.repeat(40) + '{}' + ']'.repeat(40))
    expect(() => api.discoverLocalCorpus(true)).toThrow(/^DISCOVERY_LIMIT$/)
  })
  it('preserves source newline distinctions and rejects lone surrogates', async () => {
    const { root, api } = await fixture(); fs.writeFileSync(join(root, 'source.json'), JSON.stringify({ cases: [{ protocolText: 'a\nb' }, { protocolText: 'a\r\nb' }] }))
    expect(api.discoverLocalCorpus(true).distinctSourceCount).toBe(2)
    fs.writeFileSync(join(root, 'source.json'), JSON.stringify({ protocolText: '\ud800' }))
    expect(() => api.discoverLocalCorpus(true)).toThrow(/^DISCOVERY_INVALID_JSON$/)
  })
})
