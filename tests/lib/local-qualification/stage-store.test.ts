import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync, chmodSync, linkSync, symlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createStageStore, createTestStageStore, createTestArtifactStore } from '../../../lib/local-qualification/stage-store'
import { runStages } from '../../../lib/local-qualification/stages'
const faults = vi.hoisted(() => ({ failSync: false, syncs: 0 }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, fsyncSync: (fd: number) => { faults.syncs++; if (faults.failSync) throw new Error('SECRET sync failure'); return actual.fsyncSync(fd) } }
})
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex')
let root: string
beforeEach(() => { root = mkdtempSync(join(realpathSync(tmpdir()), 'synthetic-stage-store-')) })
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }) })
const store = () => createTestStageStore({ root, synthetic: true })
const filename = (key: string) => join(root, 'stages', `${hash(key)}.stage`)
describe('private durable stage store', () => {
  it('persists and resumes the actual stage DAG without any provider jobs', async () => {
    const options = {
      binding: { sourceId: `sha256:${'a'.repeat(64)}`, sourceVersion: 'synthetic-v1', evidenceHash: 'b'.repeat(64), evidenceVersion: 'synthetic-v1', contractVersion: 'v1' },
      config: Object.freeze({ reviewId: 'synthetic', roles: Object.freeze({}) }), jobs: {}, timeoutMs: 1000,
    }
    const first = await runStages({ ...options, store: store() })
    expect(await runStages({ ...options, store: store() })).toEqual(first)
    expect(first.ready).toBe(false)
  })
  it('allows only one create-only append across racing real processes', async () => {
    const script = `import {createTestStageStore} from './lib/local-qualification/stage-store.ts';createTestStageStore({root:process.argv[1],synthetic:true}).append('racing','synthetic').then(()=>console.log('OK'),e=>console.log(e.message))`
    const run = () => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, root], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; child.stdout.on('data', b => { output += b }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error('child failed')))
    })
    expect((await Promise.all([run(), run()])).sort()).toEqual(['OK', 'STAGE_EXISTS'])
    expect(await store().read('racing')).toBe('synthetic')
  }, 15_000)
  it('round-trips exact bounded strings through hashed keys and restrictive files', async () => {
    const s = store(), key = 'sha256:' + 'a'.repeat(64) + '/extraction/start'
    expect(await s.read(key)).toBeNull()
    await s.append(key, 'é'.repeat(8192))
    expect(await store().read(key)).toBe('é'.repeat(8192))
    expect(readdirSync(join(root, 'stages'))).toEqual([`${hash(key)}.stage`])
    expect(statSync(join(root, 'stages')).mode & 0o777).toBe(0o700)
    expect(statSync(filename(key)).mode & 0o777).toBe(0o600)
    await expect(s.append(key, 'replacement')).rejects.toThrow('STAGE_EXISTS')
    await expect(s.append('large', 'é'.repeat(8193))).rejects.toThrow('STAGE_INVALID')
    await expect(s.append('bad', '\ud800')).rejects.toThrow('STAGE_INVALID')
    await s.append('execution-fence/0/start', 'a'.repeat(64))
    expect(await s.read('execution-fence/0/start')).toBe('a'.repeat(64))
  })
  it('rejects truncation, substitution and oversized disk records', async () => {
    const s = store(); await s.append('a', 'synthetic'); await s.append('b', 'different')
    writeFileSync(filename('b'), readFileSync(filename('a')))
    await expect(s.read('b')).rejects.toThrow('STAGE_CORRUPT')
    writeFileSync(filename('a'), '') // crash after exclusive create, before write
    await expect(s.read('a')).rejects.toThrow('STAGE_CORRUPT')
    await expect(s.append('a', 'retry')).rejects.toThrow('STAGE_EXISTS')
    writeFileSync(filename('a'), Buffer.alloc(20_000))
    await expect(s.read('a')).rejects.toThrow('STAGE_CORRUPT')
  })
  it('rejects links and permissive file or directory metadata', async () => {
    const s = store(); await s.append('a', 'synthetic')
    chmodSync(filename('a'), 0o644)
    await expect(s.read('a')).rejects.toThrow('STAGE_UNSAFE_PATH')
    chmodSync(filename('a'), 0o600); linkSync(filename('a'), join(root, 'hardlink'))
    await expect(s.read('a')).rejects.toThrow('STAGE_UNSAFE_PATH')
    symlinkSync(filename('a'), filename('link'))
    await expect(s.read('link')).rejects.toThrow('STAGE_UNSAFE_PATH')
    chmodSync(join(root, 'stages'), 0o755)
    await expect(s.read('missing')).rejects.toThrow('STAGE_UNSAFE_PATH')
  })
  it('never follows a root symlink', async () => {
    mkdirSync(join(root, 'actual'), { mode: 0o700 }); symlinkSync(join(root, 'actual'), join(root, 'alias'))
    await expect(createTestStageStore({ root: join(root, 'alias'), synthetic: true }).read('a')).rejects.toThrow('STAGE_UNSAFE_PATH')
  })
  it('globally excludes async work even when keys differ, and releases after success', async () => {
    const s = store(); let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const first = s.exclusive('one', async () => { await gate; return 7 })
    await expect(store().exclusive('two', async () => 8)).rejects.toThrow('STAGE_BUSY')
    release(); expect(await first).toBe(7)
    expect(await store().exclusive('three', async () => 9)).toBe(9)
  })
  it('retains uncertainty lock on rejected work and redacts arbitrary error content', async () => {
    await expect(store().exclusive('a', async () => { throw new Error('SECRET /private/source') })).rejects.toThrow('STAGE_WORK_FAILED')
    await expect(store().exclusive('b', async () => 1)).rejects.toThrow('STAGE_BUSY')
    expect(readFileSync(join(root, 'stages', '.lock'), 'utf8')).not.toContain('SECRET')
  })
  it('has a test-only synthetic root capability, and rejects production root arguments', () => {
    expect(() => createTestStageStore({ root, synthetic: false as true })).toThrow('STAGE_TEST_ONLY')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => store()).toThrow('STAGE_TEST_ONLY')
    expect(() => (createStageStore as (...args: unknown[]) => unknown)({ root })).toThrow('STAGE_INVALID')
  })
  it('blocks another real process and never steals a killed holder lock', async () => {
    const script = `import {createTestStageStore} from './lib/local-qualification/stage-store.ts'; const s=createTestStageStore({root:process.argv[1],synthetic:true}); s.exclusive('child',async()=>{console.log('LOCKED');await new Promise(()=>{})}).catch(()=>process.exit(2));setInterval(()=>{},1000)`
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, root], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await new Promise<void>((resolve, reject) => { child.stdout.once('data', b => String(b).includes('LOCKED') ? resolve() : reject(new Error('child failed'))); child.once('exit', () => reject(new Error('child exited'))); child.once('error', reject) })
      await expect(store().exclusive('parent', async () => 1)).rejects.toThrow('STAGE_BUSY')
      const exited = new Promise<void>(r => child.once('exit', () => r())); child.kill('SIGKILL'); await exited
      await expect(store().exclusive('after-crash', async () => 1)).rejects.toThrow('STAGE_BUSY')
    } finally { child.kill('SIGKILL') }
  }, 15_000)
})
describe('private content-addressed artifacts', () => {
  it('syncs both file and directory even for a pre-existing complete artifact', async () => {
    const a = createTestArtifactStore({ root, synthetic: true }), raw = Buffer.from('synthetic')
    await a.put(raw); faults.syncs = 0
    await a.put(raw)
    expect(faults.syncs).toBeGreaterThanOrEqual(2)
  })
  it('does not resolve a write when fsync fails after file creation', async () => {
    const s = store(); await s.read('initialize')
    faults.failSync = true
    try { await expect(s.append('created', 'synthetic')).rejects.toThrow('STAGE_UNSAFE_PATH') }
    finally { faults.failSync = false }
    // A complete but unacknowledged file cannot be retried as a fresh append.
    expect(await s.read('created')).toBe('synthetic')
    await expect(s.append('created', 'synthetic')).rejects.toThrow('STAGE_EXISTS')
  })
  it('persists exact bytes separately and verifies hashes on reads and duplicate puts', async () => {
    const a = createTestArtifactStore({ root, synthetic: true }), raw = Buffer.from('synthetic source/evidence')
    const id = await a.put(raw)
    expect(id).toBe(hash(raw)); expect(await a.read(id)).toEqual(raw)
    expect(await a.put(raw)).toBe(id)
    expect(await a.read('0'.repeat(64))).toBeNull()
    const path = join(root, 'artifacts', `${id}.raw`)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    writeFileSync(path, 'corrupt')
    await expect(a.read(id)).rejects.toThrow('STAGE_CORRUPT')
    await expect(a.put(raw)).rejects.toThrow('STAGE_CORRUPT')
    await expect(a.put(Buffer.alloc(8 * 1024 * 1024 + 1))).rejects.toThrow('STAGE_INVALID')
    await expect(a.read('../secret')).rejects.toThrow('STAGE_INVALID')
  })
})
