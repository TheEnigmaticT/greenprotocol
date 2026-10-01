import { describe, expect, it } from 'vitest'
import { projectSciSureResult } from '@/lib/integrations/scisure'
import { runOneSciSureJob, type SciSureWorkerStore } from '@/lib/integrations/scisure/worker'
import type { Recommendation } from '@/lib/types'

describe('SciSure real-result worker to review projection chain', () => {
  it('keeps an eligible real Recommendation proposed until a durable review decision is supplied', async () => {
    let persisted: unknown
    const store: SciSureWorkerStore = {
      async lease() { return { id: 'job-1', leaseToken: 'lease-1', principalId: 'principal-1', principalKind: 'registered', ownerUserId: 'user-1', snapshotId: 'snapshot-1', sourceHash: 'a'.repeat(64), protocolText: 'Add N,N-Dimethylformamide, then stir.' } },
      async complete(input) { persisted = input.result; return true },
      async fail() { return true },
    }
    const recommendation: Recommendation = {
      id: 'rec-safe', stepNumber: 4, principleNumbers: [5], principleNames: ['Safer solvents'], severity: 'high',
      original: { chemical: 'N,N-Dimethylformamide', issue: 'Hazardous solvent' },
      alternative: { chemical: 'Ethyl acetate', rationale: 'Lower hazard', yieldImpact: 'Validate experimentally', caveats: 'Confirm compatibility before use.', evidenceBasis: 'Direct literature support' },
      confidenceLevel: 'medium', cardKind: 'swap', isAccepted: false,
      evidenceAssessment: { disposition: 'supported_applicable', directness: 'direct', supportingReferenceCount: 1, applicability: 'strong', eligibleForApplication: true, eligibilityReason: 'Direct evidence supports this exact intervention.' },
    }

    await expect(runOneSciSureJob(store, async () => ({ recommendations: [recommendation] }))).resolves.toEqual({ jobId: 'job-1', status: 'completed' })
    const raw = persisted as { recommendations: Recommendation[] }
    const base = { bridgeSessionId: 'bridge-1', snapshotId: 'snapshot-1', sourceHash: 'a'.repeat(64), runId: 'job-1', status: 'completed' as const, selection: [{ stepId: 'prot-step-4', order: 4 }], recommendations: raw.recommendations }
    expect(projectSciSureResult(base).recommendations).toMatchObject([{ recommendationId: 'rec-safe', sourceStepId: 'prot-step-4', decision: 'proposed' }])
    expect(projectSciSureResult({ ...base, reviewDecisions: { 'rec-safe': 'approved_for_experiment' } }).recommendations).toMatchObject([{ recommendationId: 'rec-safe', decision: 'accepted' }])
  })
})
