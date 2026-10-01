import { describe, expect, it } from 'vitest'
import { runOneSciSureJob, type SciSureWorkerStore } from '@/lib/integrations/scisure/worker'
import type { Recommendation } from '@/lib/types'

const supportedSwap: Recommendation = {
  id: 'rec-1', stepNumber: 1, principleNumbers: [5], principleNames: ['Safer solvents'], severity: 'high',
  original: { chemical: 'N,N-Dimethylformamide', issue: 'Hazardous solvent' },
  alternative: { chemical: 'Ethyl acetate', rationale: 'Lower hazard', yieldImpact: 'Validate experimentally', caveats: 'Confirm compatibility before use.', evidenceBasis: 'Direct literature support' },
  confidenceLevel: 'medium', cardKind: 'swap', isAccepted: false,
  evidenceAssessment: { disposition: 'supported_applicable', directness: 'direct', supportingReferenceCount: 1, applicability: 'strong', eligibleForApplication: true, eligibilityReason: 'Direct evidence supports this exact intervention.' },
}

describe('SciSure durable worker', () => {
  it('leases a queued job, persists a scoped result, and completes it', async () => {
    const events: string[] = []
    const store: SciSureWorkerStore = {
      async lease() { return { id: 'job-1', leaseToken: 'lease-1', principalId: 'guest-1', principalKind: 'guest', ownerUserId: null, snapshotId: 'snap-1', sourceHash: 'source-1', protocolText: 'Add water, then stir for 20 minutes.' } },
      async complete(input) { events.push(`complete:${input.jobId}:${input.analysisId ?? 'guest'}`); return true },
      async fail(input) { events.push(`fail:${input.jobId}:${input.status}`); return true },
    }
    const result = await runOneSciSureJob(store, async (protocolText, context) => {
      expect(protocolText).toContain('water')
      expect(context).toEqual({ userId: undefined, analysisRunId: undefined, supabase: undefined, retrievalScope: 'public-only' })
      return { recommendations: [supportedSwap] }
    })
    expect(result).toEqual({ jobId: 'job-1', status: 'completed' })
    expect(events).toEqual(['complete:job-1:guest'])
  })

  it('passes registered identity and durable run provenance into the pipeline', async () => {
    const store: SciSureWorkerStore = {
      async lease() { return { id: 'job-1', leaseToken: 'lease-1', principalId: 'principal-1', principalKind: 'registered', ownerUserId: 'user-1', analysisRunId: 'run-1', snapshotId: 'snap-1', sourceHash: 'source-1', protocolText: 'Add water, then stir for 20 minutes.' } },
      async complete() { return true },
      async fail() { return true },
    }
    await expect(runOneSciSureJob(store, async (_protocolText, context) => {
      expect(context.userId).toBe('user-1')
      expect(context.analysisRunId).toBe('run-1')
      expect(context.retrievalScope).toBe('public-only')
      return { recommendations: [] }
    })).resolves.toEqual({ jobId: 'job-1', status: 'completed' })
  })

  it('marks a thrown execution as uncertain rather than leaving it queued', async () => {
    const states: string[] = []
    const store: SciSureWorkerStore = {
      async lease() { return { id: 'job-1', leaseToken: 'lease-1', principalId: 'principal-1', principalKind: 'registered', ownerUserId: 'user-1', analysisRunId: 'run-1', snapshotId: 'snap-1', sourceHash: 'source-1', protocolText: 'Add water, then stir for 20 minutes.' } },
      async complete() { throw new Error('not reached') },
      async fail(input) { states.push(input.status); return true },
    }
    await expect(runOneSciSureJob(store, async () => { throw new Error('provider unavailable') })).resolves.toEqual({ jobId: 'job-1', status: 'uncertain' })
    expect(states).toEqual(['uncertain'])
  })
})
