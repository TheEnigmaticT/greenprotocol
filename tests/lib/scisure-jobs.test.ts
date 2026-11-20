import { describe, expect, it } from 'vitest'
import { admitJob, completeJob, failJob, type DurableSciSureStore } from '@/lib/integrations/scisure/jobs'

describe('durable SciSure job admission', () => {
  function store(): DurableSciSureStore & { reservations: Map<string, string>; jobs: Map<string, { status: string }> } {
    const reservations = new Map<string, string>()
    const jobs = new Map<string, { status: string }>()
    return {
      reservations, jobs,
      async reserve(input) {
        const prior = reservations.get(`${input.principalId}:${input.idempotencyKey}`)
        if (prior) return { kind: 'existing', jobId: prior }
        const jobId = `job-${reservations.size + 1}`
        reservations.set(`${input.principalId}:${input.idempotencyKey}`, jobId)
        jobs.set(jobId, { status: 'queued' })
        return { kind: 'created', jobId }
      },
      async transition(jobId, from, to) { const job = jobs.get(jobId); if (!job || job.status !== from) return false; job.status = to; return true },
    }
  }

  it('reuses an idempotent reservation instead of spending quota twice', async () => {
    const db = store()
    expect(await admitJob(db, { principalId: 'guest-a', snapshotId: 'snap-1', idempotencyKey: 'request-1' })).toEqual({ jobId: 'job-1', replayed: false })
    expect(await admitJob(db, { principalId: 'guest-a', snapshotId: 'snap-1', idempotencyKey: 'request-1' })).toEqual({ jobId: 'job-1', replayed: true })
    expect(db.jobs.size).toBe(1)
  })

  it('never converts uncertain execution into success or an automatic retry', async () => {
    const db = store(); const admission = await admitJob(db, { principalId: 'guest-a', snapshotId: 'snap-1', idempotencyKey: 'request-1' })
    expect(await failJob(db, admission.jobId, true)).toBe('uncertain')
    expect(db.jobs.get(admission.jobId)?.status).toBe('uncertain')
    expect(await completeJob(db, admission.jobId)).toBe(false)
  })
})
