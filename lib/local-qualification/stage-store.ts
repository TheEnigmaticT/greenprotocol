import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, unlinkSync, writeFileSync, type Stats } from 'node:fs'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { PRIVATE_ROOT, digest } from './manifests'
import type { StageStore } from './stages'

const STAGE_LIMIT = 16_384
const ARTIFACT_LIMIT = 8 * 1024 * 1024
const HEADER = 72
const HASH = /^[a-f0-9]{64}$/
class StoreError extends Error { constructor(code: string) { super(code); this.name = 'StageStoreError' } }
function fail(code: string): never { throw new StoreError(code) }
function safe<T>(fn: () => T): T {
  try { return fn() } catch (e) { throw new StoreError(e instanceof StoreError ? e.message : 'STAGE_UNSAFE_PATH') }
}
function same(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino }
function owner(s: Stats): boolean { return typeof process.getuid === 'function' && s.uid === process.getuid() }
function privateFile(s: Stats): void {
  if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o7777) !== 0o600 || !owner(s)) fail('STAGE_UNSAFE_PATH')
}
function syncDirectory(path: string): void {
  const before = lstatSync(path)
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY)
  try {
    const opened = fstatSync(fd)
    if (!opened.isDirectory() || !same(before, opened)) fail('STAGE_UNSAFE_PATH')
    fsyncSync(fd)
  } finally { closeSync(fd) }
}
/** No recursive mkdir through symlinks, no chmod repair of pre-existing authority. */
function prepare(privateRoot: string, leaf: 'stages' | 'artifacts'): string {
  if (!isAbsolute(privateRoot) || resolve(privateRoot) !== privateRoot) fail('STAGE_UNSAFE_PATH')
  const root = join(privateRoot, leaf)
  let cursor = parse(root).root
  for (const component of root.slice(cursor.length).split('/').filter(Boolean)) {
    cursor = join(cursor, component)
    try { lstatSync(cursor) } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      try { mkdirSync(cursor, { mode: 0o700 }); syncDirectory(dirname(cursor)) } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
    }
    const s = lstatSync(cursor)
    if (!s.isDirectory() || s.isSymbolicLink()) fail('STAGE_UNSAFE_PATH')
    if ([privateRoot, root].includes(cursor) && ((s.mode & 0o7777) !== 0o700 || !owner(s))) fail('STAGE_UNSAFE_PATH')
  }
  return root
}
function stable(a: Stats, b: Stats): boolean {
  return same(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
}
/** Synchronous bounded critical sections prevent in-process await substitution races.
 * Descriptor/path identity and metadata are checked again after every read/write. */
class PrivateDisk {
  constructor(private readonly privateRoot: string, private readonly leaf: 'stages' | 'artifacts') {}
  root(): string { return prepare(this.privateRoot, this.leaf) }
  read(name: string, max: number): Buffer | null {
    const root = this.root(), directory = lstatSync(root), path = join(root, name)
    let before: Stats
    try { before = lstatSync(path) } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      if (!same(directory, lstatSync(this.root()))) fail('STAGE_UNSAFE_PATH')
      return null
    }
    privateFile(before)
    if (before.size > max) fail('STAGE_CORRUPT')
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const opened = fstatSync(fd); privateFile(opened)
      if (!stable(before, opened)) fail('STAGE_UNSAFE_PATH')
      const bytes = Buffer.alloc(opened.size + 1)
      let count = 0
      while (count < bytes.length) {
        const n = readSync(fd, bytes, count, bytes.length - count, count)
        if (!n) break
        count += n
      }
      const after = fstatSync(fd), named = lstatSync(path)
      privateFile(after); privateFile(named)
      if (!stable(opened, after) || !stable(after, named) || !same(directory, lstatSync(this.root()))) fail('STAGE_UNSAFE_PATH')
      if (count !== opened.size) fail('STAGE_CORRUPT')
      return bytes.subarray(0, count)
    } finally { closeSync(fd) }
  }
  write(name: string, bytes: Buffer): void {
    const root = this.root(), directory = lstatSync(root), path = join(root, name)
    let fd: number
    try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600) } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') fail(name === '.lock' ? 'STAGE_BUSY' : 'STAGE_EXISTS')
      throw e
    }
    // Never unlink an incomplete write: its existence is an uncertainty marker.
    try {
      privateFile(fstatSync(fd)); writeFileSync(fd, bytes); fsyncSync(fd)
      const opened = fstatSync(fd), named = lstatSync(path)
      privateFile(opened); privateFile(named)
      if (!stable(opened, named) || opened.size !== bytes.length || !same(directory, lstatSync(this.root()))) fail('STAGE_UNSAFE_PATH')
    } finally { closeSync(fd) }
    syncDirectory(root)
    const actual = this.read(name, bytes.length)
    if (!actual?.equals(bytes)) fail('STAGE_CORRUPT')
  }
  ensureDurable(name: string, bytes: Buffer): void {
    const root = this.root(), path = join(root, name), before = lstatSync(path)
    privateFile(before)
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const opened = fstatSync(fd); privateFile(opened)
      if (!stable(before, opened)) fail('STAGE_UNSAFE_PATH')
      fsyncSync(fd)
      if (!stable(opened, fstatSync(fd))) fail('STAGE_UNSAFE_PATH')
    } finally { closeSync(fd) }
    syncDirectory(root)
    if (!this.read(name, bytes.length)?.equals(bytes)) fail('STAGE_CORRUPT')
  }
  release(identity: Stats): void {
    const root = this.root(), named = lstatSync(join(root, '.lock'))
    privateFile(named)
    if (!same(identity, named)) fail('STAGE_UNSAFE_PATH')
    unlinkSync(join(root, '.lock')); syncDirectory(root)
  }
}
function keyHash(key: string): string {
  if (typeof key !== 'string' || key.length === 0 || key.length > 4096 || Buffer.from(key).toString('utf8') !== key) fail('STAGE_INVALID')
  return digest(key)
}
function encode(key: string, raw: string): Buffer {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > STAGE_LIMIT || Buffer.from(raw).toString('utf8') !== raw) fail('STAGE_INVALID')
  const bytes = Buffer.from(raw), header = Buffer.alloc(HEADER)
  header.write('STG1'); Buffer.from(key, 'hex').copy(header, 4); Buffer.from(digest(bytes), 'hex').copy(header, 36); header.writeUInt32BE(bytes.length, 68)
  return Buffer.concat([header, bytes])
}
function decode(key: string, bytes: Buffer): string {
  if (bytes.length < HEADER || bytes.toString('ascii', 0, 4) !== 'STG1' || bytes.subarray(4, 36).toString('hex') !== key || bytes.readUInt32BE(68) !== bytes.length - HEADER || digest(bytes.subarray(HEADER)) !== bytes.subarray(36, 68).toString('hex')) fail('STAGE_CORRUPT')
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(HEADER)) } catch { return fail('STAGE_CORRUPT') }
}
class DiskStageStore implements StageStore {
  private readonly disk: PrivateDisk
  private held = false
  private poisoned = false
  constructor(root: string) { this.disk = new PrivateDisk(root, 'stages') }
  async exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    const identity = safe(() => {
      keyHash(key)
      if (typeof work !== 'function') fail('STAGE_INVALID')
      this.disk.write('.lock', Buffer.from('isolated-stages/global/v1\n'))
      this.held = true; this.poisoned = false
      return lstatSync(join(this.disk.root(), '.lock'))
    })
    // Any rejected callback may have an unsettled external operation: never steal/release.
    let result: T
    try { result = await work() } catch { this.held = false; throw new StoreError('STAGE_WORK_FAILED') }
    this.held = false
    if (this.poisoned) fail('STAGE_CORRUPT')
    safe(() => this.disk.release(identity))
    return result
  }
  async read(key: string): Promise<string | null> {
    try { return safe(() => { const id = keyHash(key), raw = this.disk.read(`${id}.stage`, STAGE_LIMIT + HEADER); return raw === null ? null : decode(id, raw) }) }
    catch (e) { if (this.held) this.poisoned = true; throw e }
  }
  async append(key: string, raw: string): Promise<void> {
    try { safe(() => { const id = keyHash(key); this.disk.write(`${id}.stage`, encode(id, raw)) }) }
    catch (e) { if (this.held) this.poisoned = true; throw e }
  }
}
export interface ArtifactStore {
  /** Raw private source/evidence bytes only; never log returned buffers. */
  put(raw: Buffer): Promise<string>
  read(hash: string): Promise<Buffer | null>
}
class DiskArtifactStore implements ArtifactStore {
  private readonly disk: PrivateDisk
  constructor(root: string) { this.disk = new PrivateDisk(root, 'artifacts') }
  async put(raw: Buffer): Promise<string> {
    return safe(() => {
      if (!Buffer.isBuffer(raw) || raw.length > ARTIFACT_LIMIT) fail('STAGE_INVALID')
      const bytes = Buffer.from(raw), id = digest(bytes)
      const previous = this.disk.read(`${id}.raw`, ARTIFACT_LIMIT)
      if (previous !== null) {
        if (!previous.equals(bytes)) fail('STAGE_CORRUPT')
        this.disk.ensureDurable(`${id}.raw`, bytes)
        return id
      }
      // Concurrent publishers may race. Existing partial/corrupt bytes never authorize success.
      try { this.disk.write(`${id}.raw`, bytes) } catch (e) {
        if (!(e instanceof StoreError) || e.message !== 'STAGE_EXISTS') throw e
        const existing = this.disk.read(`${id}.raw`, ARTIFACT_LIMIT)
        if (!existing?.equals(bytes)) fail('STAGE_CORRUPT')
        this.disk.ensureDurable(`${id}.raw`, bytes)
      }
      return id
    })
  }
  async read(hash: string): Promise<Buffer | null> {
    return safe(() => {
      if (typeof hash !== 'string' || !HASH.test(hash)) fail('STAGE_INVALID')
      const bytes = this.disk.read(`${hash}.raw`, ARTIFACT_LIMIT)
      if (bytes !== null && digest(bytes) !== hash) fail('STAGE_CORRUPT')
      return bytes
    })
  }
}
/** Fixed authority; arguments and environment root overrides are not accepted. */
export function createStageStore(...args: never[]): StageStore {
  if (args.length) fail('STAGE_INVALID')
  return new DiskStageStore(resolve(PRIVATE_ROOT))
}
export function createArtifactStore(...args: never[]): ArtifactStore {
  if (args.length) fail('STAGE_INVALID')
  return new DiskArtifactStore(resolve(PRIVATE_ROOT))
}
/** Separate lock domain: transport persistence runs inside the stage-run lock. */
export function createLocalTransportStore(): StageStore {
  return new DiskStageStore(resolve(PRIVATE_ROOT, 'local-transport'))
}
interface TestOptions { root: string; synthetic: true }
function testRoot(options: TestOptions): string {
  if (process.env.NODE_ENV !== 'test' || options?.synthetic !== true) fail('STAGE_TEST_ONLY')
  if (typeof options.root !== 'string') fail('STAGE_INVALID')
  return options.root
}
/** Synthetic temporary files only. Never point this capability at corpus/attempt history. */
export function createTestStageStore(options: TestOptions): StageStore { return new DiskStageStore(testRoot(options)) }
export function createTestArtifactStore(options: TestOptions): ArtifactStore { return new DiskArtifactStore(testRoot(options)) }
