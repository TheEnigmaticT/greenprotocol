import { afterEach, describe, expect, it, vi } from 'vitest'
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as manifests from '../../../lib/local-qualification/manifests'
import * as provider from '../../../lib/local-qualification/provider'

// Fault only synthetic settlement files; all other I/O remains real.
const ioFault = vi.hoisted(() => ({ mode: '' as string, rawFd: -1 }))
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const fault = () => { throw Object.assign(new Error('synthetic settlement I/O failure'), { code: 'EIO' }) }
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      const name = String(args[0])
      const writing = typeof args[1] === 'number' && (args[1] & fs.constants.O_CREAT) !== 0
      if (writing && ((name.endsWith('.raw') && ioFault.mode === 'raw-create') || (name.endsWith('.outcome.json') && ioFault.mode === 'outcome-create'))) fault()
      const fd = fs.openSync(...args)
      if (writing && name.endsWith('.raw')) ioFault.rawFd = fd
      return fd
    },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (args[0] === ioFault.rawFd && ioFault.mode === 'raw-write') fault()
      return fs.writeFileSync(...args)
    },
    fsyncSync: (fd: number) => {
      if (fd === ioFault.rawFd && ioFault.mode === 'raw-fsync') fault()
      return fs.fsyncSync(fd)
    },
    closeSync: (fd: number) => {
      if (fd === ioFault.rawFd) ioFault.rawFd = -1
      return fs.closeSync(fd)
    },
  }
})

const roots: string[] = []
const MODEL = 'google/gemma-4-31b-it'
const hash = (c = 'a') => c.repeat(64)
function root() { const p = mkdtempSync(join(realpathSync(tmpdir()), 'qualification-test-')); roots.push(p); return join(p, 'private') }
afterEach(() => { ioFault.mode = ''; ioFault.rawFd = -1; vi.unstubAllEnvs(); roots.forEach(p => rmSync(p, { recursive: true, force: true })); roots.length = 0 })
const tuple = { tupleHash: hash(), requestHash: hash('b'), attempt: 1, reservedMicroUsd: 1000 }
const request = () => ({ tupleHash: hash(), attempt: 1, model: MODEL, messages: [{ role: 'user' as const, content: 'synthetic non-chemistry fixture' }], maxCompletionTokens: 100, maxPromptTokens: 262144, prices: { prompt: 1, completion: 2, request: 0 }, output: { kind: 'json_schema' as const, name: 'answer', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } }, validate: (v: unknown) => !!v && typeof v === 'object' && (v as { ok?: unknown }).ok === true })
const response = (patch: Record<string, unknown> = {}) => new Response(JSON.stringify({ model: MODEL, usage: { cost: 0.0001 }, choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }], ...patch }), { status: 200 })
function setup(fetcher: typeof fetch = vi.fn(async () => response()), options: Record<string, unknown> = {}) { const p = root(); const transport = provider.createTestProvider({ root: p, fetch: fetcher, historicalMicroUsd: 0, ...options }); return { p, transport, fetcher } }

describe('durable private spend ledger', () => {
  it('exports the durable ledger API', () => { expect(manifests.createTestLedger).toBeTypeOf('function') })
  it('reserves before execution and survives reopening without resetting spend', () => {
    const p = root(); const ledger = manifests.createTestLedger({ root: p, historicalMicroUsd: 12 });
    ledger.withLock(() => ledger.reserve(tuple));
    expect(manifests.createTestLedger({ root: p, historicalMicroUsd: 0 }).snapshot().committedMicroUsd).toBe(1012)
    expect(() => ledger.withLock(() => ledger.reserve(tuple))).toThrow('REPLAY')
  })
  it('requires known historical spend and rejects invalid budget arithmetic', () => {
    expect(() => manifests.createTestLedger({ root: root(), historicalMicroUsd: null }).snapshot()).toThrow('HISTORY_UNKNOWN')
    for (const cap of [NaN, Infinity, -1, 0.1, 100000001]) expect(() => manifests.createTestLedger({ root: root(), historicalMicroUsd: 0, capMicroUsd: cap }).snapshot()).toThrow()
  })
  it('bounds known-cost explicit retries and never overwrites successful attempts', () => {
    const l = manifests.createTestLedger({ root: root(), historicalMicroUsd: 0 });
    l.withLock(() => { l.reserve(tuple); l.settle(tuple, { costMicroUsd: 100, status: 'error', code: 'OUTPUT_INVALID' }, Buffer.from('raw')); });
    expect(l.snapshot().committedMicroUsd).toBe(100)
    l.withLock(() => { l.reserve({ ...tuple, attempt: 2 }); l.settle({ ...tuple, attempt: 2 }, { costMicroUsd: 200, status: 'success', code: 'OK' }, Buffer.from('raw2')); });
    expect(l.snapshot().committedMicroUsd).toBe(100 + 200)
    expect(() => l.withLock(() => l.reserve({ ...tuple, attempt: 3 }))).toThrow('RETRY_INVALID')
    expect(() => l.withLock(() => l.reserve({ ...tuple, attempt: 4 }))).toThrow('RETRY_INVALID')
  })
  it('enforces cumulative budget and halts permanently on reservation overrun', () => {
    const l = manifests.createTestLedger({ root: root(), historicalMicroUsd: 99999000 });
    l.withLock(() => { l.reserve(tuple); l.settle(tuple, { costMicroUsd: 1001, status: 'error', code: 'OVER_RESERVATION' }, Buffer.from('raw')); });
    expect(l.snapshot().stopped).toBe(true)
    expect(() => l.withLock(() => l.reserve({ ...tuple, tupleHash: hash('c') }))).toThrow('LEDGER_STOPPED')
  })
  it('rejects insufficient budget before creating another attempt', () => {
    const l = manifests.createTestLedger({ root: root(), historicalMicroUsd: 99999001 });
    expect(() => l.withLock(() => l.reserve(tuple))).toThrow('BUDGET_EXCEEDED')
  })
  it('rejects unsafe hashes, symlinks and corrupt history; writes 700/600', () => {
    const p = root(); const l = manifests.createTestLedger({ root: p, historicalMicroUsd: 0 });
    expect(() => l.withLock(() => l.reserve({ ...tuple, tupleHash: '../escape' }))).toThrow('INVALID_INPUT')
    l.withLock(() => l.reserve(tuple));
    expect(statSync(p).mode & 0o777).toBe(0o700)
    for (const name of readdirSync(p)) expect(statSync(join(p, name)).mode & 0o777).toBe(0o600)
    writeFileSync(join(p, 'unexpected.json'), '{}', { mode: 0o600 })
    expect(() => l.snapshot()).toThrow('LEDGER_CORRUPT')
    const target = root(); symlinkSync(p, target); expect(() => manifests.createTestLedger({ root: target, historicalMicroUsd: 0 }).snapshot()).toThrow('UNSAFE_PATH')
  })
  it('holds exclusive lock through async work and leaves crash locks closed', async () => {
    const p = root(); const l = manifests.createTestLedger({ root: p, historicalMicroUsd: 0 });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve });
    const running = l.withLock(async () => { l.reserve(tuple); await gate });
    expect(() => manifests.createTestLedger({ root: p, historicalMicroUsd: 0 }).withLock(() => undefined)).toThrow('LEDGER_BUSY')
    release(); await running;
  })
})

describe('R1 unresolved settlement fails closed without another write', () => {
  it.each(['COST_UNKNOWN', 'HTTP_ERROR', 'OUTPUT_INVALID'])('retains unknown in-sprint cost and stops all future reservations after %s', code => {
    const p = root(), ledger = manifests.createTestLedger({ root: p, historicalMicroUsd: 12 })
    ledger.withLock(() => { ledger.reserve(tuple); ledger.settle(tuple, { costMicroUsd: null, status: 'error', code }, Buffer.from('synthetic raw failure')) })
    const before = readdirSync(p).sort()
    const reopened = manifests.createTestLedger({ root: p, historicalMicroUsd: 0 })
    expect(reopened.snapshot()).toMatchObject({ stopped: true, committedMicroUsd: 1012, attempts: 1 })
    expect(() => reopened.withLock(() => reopened.reserve({ ...tuple, attempt: 2 }))).toThrow('LEDGER_STOPPED')
    expect(() => reopened.withLock(() => reopened.reserve({ ...tuple, tupleHash: hash('c') }))).toThrow('LEDGER_STOPPED')
    expect(readdirSync(p).sort()).toEqual(before)
  })
  it.each([false, true])('stops new reservations after interrupted settlement (raw-only=%s)', hasRaw => {
    const p = root(); const ledger = manifests.createTestLedger({ root: p, historicalMicroUsd: 12 })
    ledger.withLock(() => {
      ledger.reserve(tuple)
      if (hasRaw) writeFileSync(join(p, `${tuple.tupleHash}-1.raw`), 'partial synthetic archive', { mode: 0o600 })
    })
    const reopened = manifests.createTestLedger({ root: p, historicalMicroUsd: 0 })
    expect(() => reopened.withLock(() => reopened.reserve({ ...tuple, tupleHash: hash('c') }))).toThrow('LEDGER_STOPPED')
    expect(() => reopened.withLock(() => reopened.reserve(tuple))).toThrow('REPLAY')
    expect(() => reopened.withLock(() => reopened.reserve({ ...tuple, attempt: 2 }))).toThrow('LEDGER_STOPPED')
    expect(reopened.snapshot()).toMatchObject({ committedMicroUsd: 1012, attempts: 1, stopped: true })
  })

  it.each(['raw-create', 'raw-write', 'raw-fsync', 'outcome-create'])('blocks a second transport after abort-ignoring deadline and %s failure', async mode => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic')
    let signal: AbortSignal | null | undefined
    const fetcher = vi.fn<typeof fetch>((_url, options) => {
      signal = options?.signal
      return new Promise<Response>(() => undefined) // Deliberately ignores abort.
    })
    const { p, transport } = setup(fetcher, { timeoutMs: 10 })
    ioFault.mode = mode
    await expect(transport.execute(request())).rejects.toThrow('PRIVATE_IO_ERROR')
    expect(signal?.aborted).toBe(true)
    const files = readdirSync(p).sort()
    expect(files).not.toContain('.lock') // Exercise caught failure, not stale-lock protection.
    expect(files.some(f => f.endsWith('.outcome.json'))).toBe(false)
    expect(files.some(f => f.endsWith('.raw'))).toBe(mode !== 'raw-create')
    ioFault.mode = '' // Transient filesystem failure clears; remote execution is still unresolved.
    fetcher.mockImplementation(async () => response())
    const reopened = provider.createTestProvider({ root: p, historicalMicroUsd: 0, fetch: fetcher })
    await expect(reopened.execute({ ...request(), tupleHash: hash('c') })).rejects.toThrow('LEDGER_STOPPED')
    await expect(transport.execute({ ...request(), tupleHash: hash('d') })).rejects.toThrow('LEDGER_STOPPED')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(manifests.createTestLedger({ root: p, historicalMicroUsd: 0 }).snapshot()).toMatchObject({ stopped: true, attempts: 1 })
    expect(readdirSync(p).sort()).toEqual(files) // No compensating stop marker or new reservation.
  })
})

describe('additional fail-closed regression gates', () => {
  it('rejects malformed UTF-8 without repairing raw model output into valid JSON', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic')
    const encoded = Buffer.from(JSON.stringify({ model: MODEL, usage: { cost: 0.0001 }, choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}', ignored: 'X' } }] }))
    encoded[encoded.indexOf('X')] = 255
    const { p, transport } = setup(vi.fn(async () => new Response(encoded)))
    await expect(transport.execute(request())).rejects.toThrow('OUTPUT_INVALID')
    expect(readFileSync(join(p, readdirSync(p).find(f => f.endsWith('.raw'))!))).toEqual(encoded)
  })
  it('does not let caller mutation switch the expected returned model during fetch', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic'); const r = request();
    const { transport } = setup(vi.fn(async () => { r.model = 'forbidden'; return response({ model: 'forbidden' }) }));
    await expect(transport.execute(r)).rejects.toThrow('MODEL_MISMATCH')
  })
  it('does not let caller mutation replace semantic validation while network is pending', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic'); const r = request(); r.validate = () => false;
    const { transport } = setup(vi.fn(async () => { r.validate = () => true; return response() }));
    await expect(transport.execute(r)).rejects.toThrow('OUTPUT_INVALID')
  })
  it('archives plaintext HTTP errors with an HTTP error code, not parser error', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic'); const { p, transport } = setup(vi.fn(async () => new Response('private upstream issue', { status: 502 })));
    await expect(transport.execute(request())).rejects.toThrow('HTTP_ERROR')
    expect(readFileSync(join(p, readdirSync(p).find(f => f.endsWith('.raw'))!), 'utf8')).toBe('private upstream issue')
  })
  it('keeps ledger stopped after a timeout even if transport ignores abort', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic'); const fetcher = vi.fn(() => new Promise<Response>(() => undefined)); const { transport } = setup(fetcher, { timeoutMs: 10 });
    await expect(transport.execute(request())).rejects.toThrow('DEADLINE')
    await expect(transport.execute({ ...request(), tupleHash: hash('c') })).rejects.toThrow('LEDGER_STOPPED')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('refuses retry reservation changes for the same request', () => {
    const l = manifests.createTestLedger({ root: root(), historicalMicroUsd: 0 });
    l.withLock(() => { l.reserve(tuple); l.settle(tuple, { costMicroUsd: 100, status: 'error', code: 'OUTPUT_INVALID' }, Buffer.from('raw')) });
    expect(() => l.withLock(() => l.reserve({ ...tuple, attempt: 2, reservedMicroUsd: 1 }))).toThrow('RETRY_INVALID')
  })
  it('checks dollar conversion without floating accumulation', () => {
    expect(provider.usdToMicroUsd(0.00000001)).toBe(1)
    expect(provider.usdToMicroUsd(0.0001)).toBe(100)
    expect(provider.usdToMicroUsd(1.0000001)).toBe(1000001)
    for (const cost of [NaN, Infinity, -0.1, '0', null]) expect(provider.usdToMicroUsd(cost)).toBeNull()
  })
  it('rejects unsafe test use outside test environment', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => manifests.createTestLedger({ root: root(), historicalMicroUsd: 0 })).toThrow('TEST_ONLY')
    expect(() => provider.createTestProvider({ root: root(), historicalMicroUsd: 0, fetch: vi.fn() })).toThrow('TEST_ONLY')
  })
  it('rejects native fetch and missing credentials without network', async () => {
    expect(() => provider.createTestProvider({ root: root(), historicalMicroUsd: 0, fetch })).toThrow('SYNTHETIC_TRANSPORT_REQUIRED')
    vi.stubEnv('OPENROUTER_API_KEY', ''); const { transport, fetcher } = setup()
    await expect(transport.execute(request())).rejects.toThrow('KEY_MISSING'); expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([NaN, Infinity, -1])('rejects nonfinite or negative price %s before network', async price => {
    const { transport, fetcher } = setup(); const r = request(); r.prices.prompt = price;
    await expect(transport.execute(r)).rejects.toThrow('INVALID_INPUT'); expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    { finish_reason: 'stop', message: { tool_calls: [{ type: 'function', function: { name: 'answer', arguments: '{"ok":true}' } }] } },
    { finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: 'wrong', arguments: '{"ok":true}' } }] } },
    { finish_reason: 'tool_calls', message: { tool_calls: [] } },
    { finish_reason: 'tool_calls', message: { tool_calls: [{}, {}] } },
  ])('rejects wrong tool/finish/count %#', async choice => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic'); const { transport } = setup(vi.fn(async () => response({ choices: [choice] }))); const r = request();
    await expect(transport.execute({ ...r, output: { ...r.output, kind: 'tool' } })).rejects.toThrow('OUTPUT_INVALID')
  })
  it('stops on observed cost beyond reservation and retains actual spend', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'synthetic'); const { p, transport, fetcher } = setup(vi.fn(async () => response({ usage: { cost: 1 } })));
    await expect(transport.execute(request())).rejects.toThrow('OVER_RESERVATION')
    const s = manifests.createTestLedger({ root: p, historicalMicroUsd: 0 }).snapshot(); expect(s.committedMicroUsd).toBe(1000000); expect(s.stopped).toBe(true)
    await expect(transport.execute({ ...request(), tupleHash: hash('c') })).rejects.toThrow('LEDGER_STOPPED'); expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('detects raw tampering, symlink files, and hardlinked history', () => {
    for (const attack of ['tamper', 'symlink', 'hardlink']) {
      const p = root(); const l = manifests.createTestLedger({ root: p, historicalMicroUsd: 0 }); l.withLock(() => { l.reserve(tuple); l.settle(tuple, { costMicroUsd: 10, status: 'success', code: 'OK' }, Buffer.from('raw')) });
      const raw = join(p, readdirSync(p).find(f => f.endsWith('.raw'))!);
      if (attack === 'tamper') writeFileSync(raw, 'changed');
      else { const other = join(p, '..', 'outside'); writeFileSync(other, 'raw', { mode: 0o600 }); unlinkSync(raw); if (attack === 'symlink') symlinkSync(other, raw); else linkSync(other, raw) }
      expect(() => l.snapshot()).toThrow()
    }
  })
  it('refuses symlink ancestors and preexisting crash locks', () => {
    const p = root(); const target = root(); mkdirSync(target, { mode: 0o700 }); symlinkSync(target, p)
    expect(() => manifests.createTestLedger({ root: join(p, 'nested'), historicalMicroUsd: 0 }).snapshot()).toThrow('UNSAFE_PATH')
    const q = root(); mkdirSync(q, { mode: 0o700 }); writeFileSync(join(q, '.lock'), 'crashed', { mode: 0o600 });
    expect(() => manifests.createTestLedger({ root: q, historicalMicroUsd: 0 }).snapshot()).toThrow('LEDGER_BUSY')
    expect(readFileSync(join(q, '.lock'), 'utf8')).toBe('crashed')
  })
})

describe('strict serial OpenRouter boundary (synthetic transport only)', () => {
  it('exports a test transport but production remains approval-blocked', () => {
    expect(provider.createTestProvider).toBeTypeOf('function')
    expect(() => provider.createProvider()).toThrow('LIVE_NOT_APPROVED')
  })
  it('builds one strict no-fallback request, archives raw privately and returns metadata plus validated output', async () => {
    const { p, transport, fetcher } = setup(); vi.stubEnv('OPENROUTER_API_KEY', 'test-secret');
    const result = await transport.execute(request());
    expect(result.value).toEqual({ ok: true }); expect(result.costMicroUsd).toBe(100)
    const [url, options] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions'); expect(options?.redirect).toBe('error');
    const body = JSON.parse(options?.body as string);
    expect(body.provider).toEqual({ allow_fallbacks: false, require_parameters: true, max_price: { prompt: 1, completion: 2, request: 0 } });
    expect(body.model).toBe(MODEL); expect(body.models).toBeUndefined(); expect(body.max_tokens).toBe(100); expect(body.stream).toBe(false)
    expect(body.response_format.json_schema.strict).toBe(true)
    const files = readdirSync(p); expect(files.some(f => f.endsWith('.raw'))).toBe(true)
    for (const f of files) expect(readFileSync(join(p, f), 'utf8')).not.toContain('test-secret')
  })
  it.each(['qwen/guessed', 'google/gemma-4-31b-it:free', 'openrouter/auto', '', 'google/gemma-4-31b-it/../x'])('rejects non-allowlisted model %s before network', async model => {
    const { transport, fetcher } = setup(); await expect(transport.execute({ ...request(), model })).rejects.toThrow('MODEL_FORBIDDEN'); expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    [{ model: undefined }, 'MODEL_MISMATCH'], [{ model: 'different' }, 'MODEL_MISMATCH'],
    [{ usage: {} }, 'COST_UNKNOWN'], [{ usage: { cost: -1 } }, 'COST_UNKNOWN'],
    [{ choices: [{ finish_reason: 'length', message: { content: '{"ok":true}' } }] }, 'OUTPUT_INVALID'],
    [{ choices: [{ finish_reason: 'stop', message: { content: '{"ok":false}' } }] }, 'OUTPUT_INVALID'],
  ])('fails closed and archives malformed result %#', async (patch, code) => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-secret'); const { p, transport } = setup(vi.fn(async () => response(patch as Record<string, unknown>)));
    await expect(transport.execute(request())).rejects.toThrow(code as string); expect(readdirSync(p).some(f => f.endsWith('.raw'))).toBe(true)
  })
  it('times out through body read, retains reservation and never retries implicitly', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-secret'); const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{partial')); } })));
    const { p, transport } = setup(fetcher, { timeoutMs: 15 });
    await expect(transport.execute(request())).rejects.toThrow('DEADLINE'); expect(fetcher).toHaveBeenCalledTimes(1)
    expect(manifests.createTestLedger({ root: p, historicalMicroUsd: 0 }).snapshot().committedMicroUsd).toBeGreaterThan(0)
    expect(readFileSync(join(p, readdirSync(p).find(f => f.endsWith('.raw'))!), 'utf8')).toBe('{partial')
  })
  it('bounds response size and redacts provider errors', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-secret'); const { transport } = setup(vi.fn(async () => new Response('private'.repeat(100))), { maxResponseBytes: 50 });
    await expect(transport.execute(request())).rejects.toThrow('RESPONSE_TOO_LARGE')
    const fail = setup(vi.fn(async () => { throw new Error('Authorization: test-secret private prompt') }));
    await expect(fail.transport.execute(request())).rejects.toThrow(/^TRANSPORT_ERROR$/)
  })
  it('rejects concurrent transports sharing a ledger before second network', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-secret'); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve });
    const fetcher = vi.fn(async () => { await gate; return response() }); const { p, transport } = setup(fetcher);
    const running = transport.execute(request()); const second = provider.createTestProvider({ root: p, historicalMicroUsd: 0, fetch: fetcher });
    await expect(second.execute({ ...request(), tupleHash: hash('c') })).rejects.toThrow('LEDGER_BUSY'); release(); await running; expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('requires one exact forced tool and tool_calls finish', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-secret'); const fetcher = vi.fn(async () => response({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: 'answer', arguments: '{"ok":true}' } }] } }] }));
    const { transport } = setup(fetcher); const r = request(); await expect(transport.execute({ ...r, output: { ...r.output, kind: 'tool' } })).resolves.toMatchObject({ value: { ok: true } });
    expect(JSON.parse(vi.mocked(fetcher as typeof fetch).mock.calls[0][1]?.body as string).tool_choice).toEqual({ type: 'function', function: { name: 'answer' } })
  })
})
