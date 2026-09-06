import { describe, expect, it, vi } from 'vitest'
import { runStages, STAGES, type StageStore, type StageJob, type StageOptions } from '../../../lib/local-qualification/stages'
import { PRINCIPLES } from '../../../lib/local-qualification/principles'

const h = 'a'.repeat(64)
function fixture() {
  const records = new Map<string, string>()
  let held = false
  const store: StageStore = {
    async exclusive(_key, work) { if (held) throw new Error('BUSY'); held = true; try { return await work() } finally { held = false } },
    async read(key) { return records.get(key) ?? null },
    async append(key, raw) { if (records.has(key)) throw new Error('EXISTS'); records.set(key, raw) },
  }
  const identity = Object.freeze({ family: 'Gemma' as const, model: 'synthetic-approved-model', modelVersion: 'fixture-v1', roleVersion: 'v1', transportVersion: 'synthetic-v1' })
  const roles = Object.freeze(Object.fromEntries(STAGES.map(stage => [stage.id, identity])))
  const options: StageOptions = {
    binding: { sourceId: `sha256:${h}`, sourceVersion: 'v1', evidenceHash: h, evidenceVersion: 'v1', contractVersion: 'v1' },
    config: Object.freeze({ reviewId: 'offline-review-fixture', roles }),
    jobs: {}, store, timeoutMs: 50,
  }
  return { options, records }
}
const candidate: StageJob = { implementationVersion: 'fixture-v1', validate: () => true, async execute() { return { status: 'candidate', code: 'SYNTHETIC', artifactHash: h } } }

describe('isolated serial durable stage substrate', () => {
  it('does not settle or bypass an uncertain job rejection at a sibling stage or changed run', async () => {
    const { options, records } = fixture()
    const calls: string[] = []
    options.jobs = Object.fromEntries(STAGES.map(s => [s.id, { ...candidate, async execute(ctx) {
      calls.push(ctx.stage)
      if (ctx.stage === 'P1') throw new Error('synthetic remote cancellation not confirmed')
      return candidate.execute(ctx)
    } } satisfies StageJob]))
    const first = await runStages(options)
    expect(calls).toEqual(['extraction', 'coverage', 'claim-audit', 'P1'])
    expect(first.stages.find(s => s.stage === 'P1')).toMatchObject({ code: 'JOB_FAILED' })
    expect(first.stages.find(s => s.stage === 'P2')).toMatchObject({ code: 'RUN_HALTED' })
    expect(records.has('execution-fence/3/settled')).toBe(false)
    options.binding = { ...options.binding, evidenceVersion: 'v2' }
    expect((await runStages(options)).stages.every(s => s.code === 'RUN_HALTED')).toBe(true)
    expect(calls).toHaveLength(4)
  })
  it('enumerates every stage honestly without installed jobs or safety claims', async () => {
    const { options } = fixture()
    const result = await runStages(options)
    expect(result.stages.map(s => s.stage)).toEqual(STAGES.map(s => s.id))
    expect(result.stages[0].status).toBe('unimplemented')
    expect(result.stages.slice(1).every(s => s.status === 'blocked')).toBe(true)
    expect(result.safetyCertified).toBe(false)
    expect(result.allTwelveSafe).toBe(false)
    expect(result.ready).toBe(false)
    expect(PRINCIPLES.P5.implementationStatus).toBe('contract-implemented-job-not-implemented')
  })
  it('runs candidates serially in deterministic order, and resumes without paid replays', async () => {
    const { options, records } = fixture()
    const calls: string[] = []
    let active = 0
    options.jobs = Object.fromEntries(STAGES.map(stage => [stage.id, { ...candidate, async execute(ctx) {
      expect(active++).toBe(0); calls.push(ctx.stage); await Promise.resolve(); active--
      expect(Object.isFrozen(ctx)).toBe(true)
      return candidate.execute(ctx)
    } } satisfies StageJob]))
    const first = await runStages(options)
    const before = [...records]
    expect(calls).toEqual(STAGES.map(s => s.id))
    expect(first.stages.every(s => s.status === 'candidate')).toBe(true)
    expect(first.ready).toBe(false)
    expect(await runStages(options)).toEqual(first)
    expect(calls).toHaveLength(STAGES.length)
    expect([...records]).toEqual(before)
  })
  it('blocks all failed dependencies and redacts thrown private text', async () => {
    const { options, records } = fixture()
    options.jobs = { extraction: { ...candidate, async execute() { throw new Error('PRIVATE CORPUS secret') } }, coverage: candidate }
    const result = await runStages(options)
    expect(result.stages[0]).toMatchObject({ status: 'failed', code: 'JOB_FAILED' })
    expect(result.stages.slice(1).every(s => s.status === 'blocked')).toBe(true)
    expect(JSON.stringify([...records])).not.toContain('PRIVATE CORPUS')
  })
  it('does not replay an uncertain durable start after result persistence fails', async () => {
    const { options } = fixture()
    const execute = vi.fn(candidate.execute)
    options.jobs = { extraction: { ...candidate, execute } }
    const append = options.store.append
    options.store.append = async (key, raw) => { if (key.endsWith('/result')) throw new Error('disk unavailable'); await append(key, raw) }
    await expect(runStages(options)).rejects.toThrow('disk unavailable')
    options.store.append = append
    const resumed = await runStages(options)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(resumed.stages[0]).toMatchObject({ status: 'failed', code: 'INTERRUPTED' })
    expect(resumed.stages.slice(1).every(s => s.status === 'blocked')).toBe(true)
  })
  it('bounds hung jobs and halts rather than launching a second job', async () => {
    const { options } = fixture()
    options.timeoutMs = 5
    let signal: AbortSignal | undefined
    options.jobs = Object.fromEntries(STAGES.map(s => [s.id, { ...candidate, execute: async ctx => { signal = ctx.signal; return new Promise(() => {}) } } satisfies StageJob]))
    const result = await runStages(options)
    expect(result.stages[0]).toMatchObject({ status: 'failed', code: 'DEADLINE' })
    expect(signal?.aborted).toBe(true)
    expect(result.stages.slice(1).every(s => s.status === 'blocked')).toBe(true)
  })
  it('fails closed on output semantics instead of converting empty recommendations to safe', async () => {
    const { options } = fixture()
    options.jobs = { extraction: { ...candidate, validate: () => false } }
    expect((await runStages(options)).stages[0]).toMatchObject({ status: 'failed', code: 'OUTPUT_INVALID' })
  })
  it('rejects mutable/unreviewed role config and forbidden family before storage or jobs', async () => {
    const { options, records } = fixture()
    options.config = { ...options.config }
    await expect(runStages(options)).rejects.toThrow('CONFIG_INVALID')
    expect(records.size).toBe(0)
    options.config = Object.freeze({ reviewId: 'review', roles: Object.freeze({ extraction: Object.freeze({ family: 'Other', model: 'x', modelVersion: 'v1', roleVersion: 'v1', transportVersion: 'v1' }) }) }) as unknown as StageOptions['config']
    await expect(runStages(options)).rejects.toThrow('CONFIG_INVALID')
  })
  it('invalidates reuse when an immutable version tuple changes', async () => {
    const { options } = fixture()
    const execute = vi.fn(candidate.execute)
    options.jobs = { extraction: { ...candidate, execute } }
    const first = await runStages(options)
    options.binding = { ...options.binding, evidenceVersion: 'v2' }
    const second = await runStages(options)
    expect(first.runId).not.toBe(second.runId)
    expect(execute).toHaveBeenCalledTimes(2)
  })
  it('retains a durable global halt after deadline even if the case tuple changes', async () => {
    const { options } = fixture()
    options.timeoutMs = 5
    const execute = vi.fn(async () => new Promise(() => {}))
    options.jobs = { extraction: { ...candidate, execute } }
    await runStages(options)
    options.binding = { ...options.binding, evidenceVersion: 'v2' }
    const second = await runStages(options)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(second.stages.every(s => s.status === 'blocked')).toBe(true)
  })
  it('rejects corrupted persisted results rather than reusing or executing', async () => {
    const { options, records } = fixture()
    await runStages(options)
    const key = [...records.keys()].find(k => k.endsWith('/result'))!
    records.set(key, '{}')
    await expect(runStages(options)).rejects.toThrow('ARTIFACT_INVALID')
  })
})
