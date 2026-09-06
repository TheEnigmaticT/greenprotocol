import { createHash } from 'node:crypto'
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PRIVATE_ROOT = fileURLToPath(new URL('../../tmp/local-qualification/', import.meta.url))
export const ATTEMPTS_ROOT = join(PRIVATE_ROOT, 'attempts')
export const CAP_MICRO_USD = 100_000_000
export const MAX_ATTEMPTS = 3
export class QualificationError extends Error { constructor(public readonly code: string) { super(code); this.name = 'QualificationError' } }
export function fail(code: string): never { throw new QualificationError(code) }
export function digest(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex') }
export function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max }
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export interface Mission { id: string; sourceEvidence: string[]; contractHash: string; roleModels: Record<string, string>; roleContracts?: Record<string, string> }
export interface Telemetry { requestedModel: string; returnedModel: string | null; provider: string | null; promptTokens: number | null; completionTokens: number | null; totalTokens: number | null; latencyMs: number; costMicroUsd: number | null; errorCode: string | null; httpStatus: number | null }
export interface Reservation { tupleHash: string; requestHash: string; attempt: number; reservedMicroUsd: number; metadata?: Record<string, unknown> }
export interface Settlement { costMicroUsd: number | null; status: 'success' | 'error'; code: string; telemetry?: Telemetry }
interface Outcome extends Settlement { rawHash: string }
interface Entry { reservation: Reservation; outcome?: Outcome }
interface Header { version: 1; historicalMicroUsd: number; capMicroUsd: number; mission?: Mission }
interface LedgerOptions { root: string; historicalMicroUsd: number | null; capMicroUsd?: number; mission?: Mission }

export function ownMission(mission: Mission): Mission {
  let m: Mission
  try { m = structuredClone(mission) } catch { return fail('MISSION_INVALID') }
  if (!m || !/^[a-zA-Z0-9_-]{1,80}$/.test(m.id) || !validHash(m.contractHash) || !Array.isArray(m.sourceEvidence) || !m.sourceEvidence.length || m.sourceEvidence.length > 10000 || !m.sourceEvidence.every(validHash) || !m.roleModels || !Object.keys(m.roleModels).length || !Object.entries(m.roleModels).every(([r, model]) => /^[a-zA-Z0-9_-]{1,80}$/.test(r) && model === 'google/gemma-4-31b-it')) fail('MISSION_INVALID')
  // contractHash identifies the whole frozen sprint contract. Optional per-role
  // pins bind the distinct extraction/inventory/principle/auditor schemas exactly.
  // Never adopt a contract from a response or fill missing role pins implicitly.
  if (m.roleContracts !== undefined && (!m.roleContracts || Array.isArray(m.roleContracts) || Object.keys(m.roleContracts).length !== Object.keys(m.roleModels).length || !Object.keys(m.roleModels).every(role => Object.hasOwn(m.roleContracts!, role) && validHash(m.roleContracts![role])))) fail('MISSION_INVALID')
  return { id: m.id, sourceEvidence: [...new Set(m.sourceEvidence)].sort(), contractHash: m.contractHash, roleModels: Object.fromEntries(Object.entries(m.roleModels).sort(([a], [b]) => a.localeCompare(b))), ...(m.roleContracts === undefined ? {} : { roleContracts: Object.fromEntries(Object.entries(m.roleContracts).sort(([a], [b]) => a.localeCompare(b))) }) }
}

function safe<T>(fn: () => T): T { try { return fn() } catch (e) { if (e instanceof QualificationError) throw e; return fail('PRIVATE_IO_ERROR') } }
function checkDirectory(path: string) {
  const s = lstatSync(path)
  if (!s.isDirectory() || s.isSymbolicLink()) fail('UNSAFE_PATH')
}
function prepareRoot(root: string) {
  if (!isAbsolute(root) || resolve(root) !== root) fail('UNSAFE_PATH')
  let part = parse(root).root
  for (const component of root.slice(part.length).split('/').filter(Boolean)) {
    part = join(part, component)
    if (!existsSync(part)) { try { mkdirSync(part, { mode: 0o700 }) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e } }
    checkDirectory(part)
  }
  const s = lstatSync(root)
  if ((s.mode & 0o777) !== 0o700 || (process.getuid && s.uid !== process.getuid())) fail('UNSAFE_PATH')
}
function syncDirectory(root: string) { const fd = openSync(root, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd) } finally { closeSync(fd) } }
function writeExclusive(root: string, name: string, value: string | Buffer) {
  prepareRoot(root)
  const fd = openSync(join(root, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { writeFileSync(fd, value); fsyncSync(fd) } finally { closeSync(fd) }
  syncDirectory(root)
}
function readPrivate(root: string, name: string): Buffer {
  prepareRoot(root)
  const fd = openSync(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const s = fstatSync(fd)
    if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o777) !== 0o600 || (process.getuid && s.uid !== process.getuid()) || s.size > 4_194_304) fail('UNSAFE_PATH')
    return readFileSync(fd)
  } finally { closeSync(fd) }
}
function readJson<T>(root: string, name: string): T { try { return JSON.parse(readPrivate(root, name).toString('utf8')) as T } catch (e) { if (e instanceof QualificationError) throw e; return fail('LEDGER_CORRUPT') } }
function validReservation(r: Reservation) {
  return r && validHash(r.tupleHash) && validHash(r.requestHash) && integer(r.attempt, MAX_ATTEMPTS) && r.attempt > 0 && integer(r.reservedMicroUsd, CAP_MICRO_USD) && r.reservedMicroUsd > 0
}
const id = (r: Reservation) => `${r.tupleHash}-${r.attempt}`

/** Append-only files. No stale-lock recovery or automatic history reconciliation. */
class AttemptLedger {
  private held = false
  private readonly options: LedgerOptions
  constructor(options: LedgerOptions) { this.options = { ...options, ...(options.mission ? { mission: ownMission(options.mission) } : {}) } }
  withLock<T>(fn: () => T): T {
    return safe(() => {
      const { root } = this.options
      prepareRoot(root)
      if (this.held) fail('LEDGER_BUSY')
      try { writeExclusive(root, '.lock', JSON.stringify({ pid: process.pid })) } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') fail('LEDGER_BUSY')
        throw e
      }
      this.held = true
      const release = () => { this.held = false; safe(() => { prepareRoot(root); unlinkSync(join(root, '.lock')); syncDirectory(root) }) }
      try {
        this.initialize()
        const result = fn()
        if (result instanceof Promise) return result.finally(release) as T
        release(); return result
      } catch (e) { if (this.held) release(); throw e }
    })
  }
  private initialize() {
    const { root, historicalMicroUsd, capMicroUsd = CAP_MICRO_USD } = this.options
    if (!integer(capMicroUsd, CAP_MICRO_USD) || capMicroUsd === 0) fail('INVALID_INPUT')
    const files = readdirSync(root).filter(f => f !== '.lock')
    if (!files.includes('ledger.json')) {
      if (files.length) fail('HISTORY_UNKNOWN')
      if (historicalMicroUsd === null) fail('HISTORY_UNKNOWN')
      if (!integer(historicalMicroUsd, capMicroUsd)) fail('INVALID_INPUT')
      writeExclusive(root, 'ledger.json', JSON.stringify({ version: 1, historicalMicroUsd, capMicroUsd, ...(this.options.mission ? { mission: this.options.mission } : {}) }))
    }
  }
  private state() {
    if (!this.held) fail('LOCK_REQUIRED')
    const root = this.options.root
    const header = readJson<Header>(root, 'ledger.json')
    if (JSON.stringify(header?.mission) !== JSON.stringify(this.options.mission)) fail('MISSION_MISMATCH')
    if (!header || header.version !== 1 || !integer(header.capMicroUsd, CAP_MICRO_USD) || header.capMicroUsd === 0 || !integer(header.historicalMicroUsd, header.capMicroUsd) || header.capMicroUsd !== (this.options.capMicroUsd ?? CAP_MICRO_USD)) fail('LEDGER_CORRUPT')
    const files = readdirSync(root).filter(f => f !== '.lock' && f !== 'ledger.json')
    const entries = new Map<string, Entry>()
    for (const f of files) {
      if (!/^[a-f0-9]{64}-[1-3]\.(reserve\.json|outcome\.json|raw)$/.test(f)) fail('LEDGER_CORRUPT')
      if (!f.endsWith('.reserve.json')) continue
      const reservation = readJson<Reservation>(root, f)
      if (!validReservation(reservation) || f !== `${id(reservation)}.reserve.json`) fail('LEDGER_CORRUPT')
      entries.set(id(reservation), { reservation })
    }
    for (const f of files) if (!entries.has(f.split('.')[0])) fail('LEDGER_CORRUPT')
    let committed = BigInt(header.historicalMicroUsd), stopped = false
    for (const [key, entry] of entries) {
      const r = entry.reservation
      if (r.attempt > 1) {
        const previous = entries.get(`${r.tupleHash}-${r.attempt - 1}`)
        if (!previous || previous.reservation.requestHash !== r.requestHash || previous.reservation.reservedMicroUsd !== r.reservedMicroUsd) fail('LEDGER_CORRUPT')
        const previousOutcome = readJson<Outcome>(root, `${id(previous.reservation)}.outcome.json`)
        if (previousOutcome.status !== 'error') fail('LEDGER_CORRUPT')
      }
      const hasRaw = files.includes(`${key}.raw`), hasOutcome = files.includes(`${key}.outcome.json`)
      let charged = r.reservedMicroUsd
      if (hasOutcome) {
        const o = readJson<Outcome>(root, `${key}.outcome.json`)
        if (!o || !hasRaw || !validHash(o.rawHash) || digest(readPrivate(root, `${key}.raw`)) !== o.rawHash || !['success', 'error'].includes(o.status) || !/^[A-Z_]{2,48}$/.test(o.code) || (o.costMicroUsd !== null && !integer(o.costMicroUsd)) || (o.status === 'success' && o.costMicroUsd === null)) fail('LEDGER_CORRUPT')
        entry.outcome = o
        if (o.costMicroUsd !== null) charged = o.costMicroUsd
        else stopped = true // Unknown in-sprint billing requires reconciliation, not a retry.
        if (charged > r.reservedMicroUsd) stopped = true
        // Abort is a request, not proof that remote execution stopped. Persist
        // this uncertainty in the outcome so reopening cannot unlock more work.
        if (['DEADLINE', 'TRANSPORT_ERROR', 'RESPONSE_TOO_LARGE'].includes(o.code)) stopped = true
      } else {
        // Settlement can fail while the filesystem cannot persist an outcome.
        // The durable reservation itself must block new work; another stop-file
        // write would have the same failure mode. Unknown-cost outcomes also
        // retain the reservation and stop; only known-cost errors may retry.
        stopped = true
        if (hasRaw) readPrivate(root, `${key}.raw`)
      }
      committed += BigInt(charged)
    }
    if (committed > BigInt(header.capMicroUsd)) stopped = true
    if (committed > BigInt(Number.MAX_SAFE_INTEGER)) fail('LEDGER_CORRUPT')
    return { entries, committedMicroUsd: Number(committed), stopped, capMicroUsd: header.capMicroUsd }
  }
  snapshot() { return this.withLock(() => { const s = this.state(); return { committedMicroUsd: s.committedMicroUsd, stopped: s.stopped, attempts: s.entries.size, capMicroUsd: s.capMicroUsd } }) }
  reserve(r: Reservation) {
    return safe(() => {
      if (!validReservation(r)) fail(r.attempt > MAX_ATTEMPTS ? 'RETRY_INVALID' : 'INVALID_INPUT')
      const s = this.state()
      if (s.entries.has(id(r))) fail('REPLAY')
      if (s.stopped) fail('LEDGER_STOPPED')
      const related = [...s.entries.values()].filter(e => e.reservation.tupleHash === r.tupleHash)
      if (r.attempt !== related.length + 1) fail('RETRY_INVALID')
      if (r.attempt > 1) {
        const previous = s.entries.get(`${r.tupleHash}-${r.attempt - 1}`)
        if (!previous?.outcome || previous.outcome.status !== 'error' || previous.reservation.requestHash !== r.requestHash || previous.reservation.reservedMicroUsd !== r.reservedMicroUsd) fail('RETRY_INVALID')
      }
      if (BigInt(s.committedMicroUsd) + BigInt(r.reservedMicroUsd) > BigInt(s.capMicroUsd)) fail('BUDGET_EXCEEDED')
      writeExclusive(this.options.root, `${id(r)}.reserve.json`, JSON.stringify(r))
    })
  }
  settle(r: Reservation, outcome: Settlement, raw: Buffer) {
    return safe(() => {
      const s = this.state(), entry = s.entries.get(id(r))
      if (!entry || entry.outcome || JSON.stringify(entry.reservation) !== JSON.stringify(r)) fail('REPLAY')
      if ((outcome.costMicroUsd !== null && !integer(outcome.costMicroUsd)) || !['success', 'error'].includes(outcome.status) || !/^[A-Z_]{2,48}$/.test(outcome.code) || (outcome.status === 'success' && outcome.costMicroUsd === null) || raw.byteLength > 4_194_304) fail('INVALID_INPUT')
      writeExclusive(this.options.root, `${id(r)}.raw`, raw)
      writeExclusive(this.options.root, `${id(r)}.outcome.json`, JSON.stringify({ ...outcome, rawHash: digest(raw) }))
    })
  }
}

/** Test-only injection; production cannot choose another root or reset its budget. */
export function createTestLedger(options: LedgerOptions) {
  if (process.env.NODE_ENV !== 'test') fail('TEST_ONLY')
  return new AttemptLedger(options)
}
/** Existing history is mandatory; provisioning/reconciliation requires independent approval. */
export function createLedger(mission?: Mission) {
  // Never silently abandon an older root ledger when moving into /attempts.
  if (existsSync(join(PRIVATE_ROOT, 'ledger.json')) || existsSync(join(PRIVATE_ROOT, '.lock'))) fail('HISTORY_RECONCILIATION_REQUIRED')
  return new AttemptLedger({ root: ATTEMPTS_ROOT, historicalMicroUsd: 0, mission })
}
