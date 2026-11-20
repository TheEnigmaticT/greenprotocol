export type ReservationInput = { principalId: string; snapshotId: string; idempotencyKey: string }
export type DurableSciSureStore = {
  reserve(input: ReservationInput): Promise<{ kind: 'created' | 'existing'; jobId: string }>
  transition(jobId: string, from: 'queued' | 'running', to: 'completed' | 'failed' | 'uncertain'): Promise<boolean>
}

export async function admitJob(store: DurableSciSureStore, input: ReservationInput) {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(input.idempotencyKey)) throw new Error('Invalid idempotency key.')
  const reservation = await store.reserve(input)
  return { jobId: reservation.jobId, replayed: reservation.kind === 'existing' }
}

export async function completeJob(store: DurableSciSureStore, jobId: string) {
  return store.transition(jobId, 'running', 'completed')
}

export async function failJob(store: DurableSciSureStore, jobId: string, executionMayHaveStarted: boolean) {
  const status = executionMayHaveStarted ? 'uncertain' : 'failed'
  const transitioned = await store.transition(jobId, 'queued', status) || await store.transition(jobId, 'running', status)
  if (!transitioned) throw new Error('Job is not in a state that can fail.')
  return status
}
