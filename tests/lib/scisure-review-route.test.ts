import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizeConnection: vi.fn(),
  requireSciSureOrigin: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/integrations/scisure/server', () => ({
  authorizeConnection: mocks.authorizeConnection,
  requireSciSureOrigin: mocks.requireSciSureOrigin,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { POST } from '@/app/api/integrations/scisure/snapshots/[id]/decisions/route'
import type { Recommendation } from '@/lib/types'

const recommendation: Recommendation = {
  id: 'rec-safe',
  stepNumber: 1, principleNumbers: [5], principleNames: ['Safer solvents'], severity: 'high',
  original: { chemical: 'N,N-Dimethylformamide', issue: 'Hazardous solvent' },
  alternative: { chemical: 'Ethyl acetate', rationale: 'Lower hazard', yieldImpact: 'Validate experimentally', caveats: 'Confirm compatibility before use.', evidenceBasis: 'Direct literature support' },
  confidenceLevel: 'medium', cardKind: 'swap', isAccepted: false,
  evidenceAssessment: { disposition: 'supported_applicable', directness: 'direct', supportingReferenceCount: 1, applicability: 'strong', eligibleForApplication: true, eligibilityReason: 'Direct evidence supports this exact intervention.' },
}

function request(body: unknown, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/integrations/scisure/snapshots/snapshot-1/decisions', {
    method: 'POST',
    headers: {
      authorization: 'Bearer bridge-secret',
      'x-gcai-bridge-session': 'bridge-1',
      'x-gcai-scisure-origin': 'https://sandbox.scisure.test',
      origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function db() {
  const reviewUpsert = vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { recommendation_id: 'rec-safe', decision: 'approved_for_experiment' }, error: null }) })) }))
  mocks.from.mockImplementation((table: string) => {
    if (table === 'gpc_external_source_snapshots') return {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'snapshot-1', source_hash: 'a'.repeat(64), source: { selection: [{ stepId: 'prot-step-1', order: 1 }] } }, error: null }) })) })) })),
    }
    if (table === 'gpc_scisure_jobs') return {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(() => ({ limit: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'job-1', status: 'completed', result: { recommendations: [recommendation] }, analysis_id: null, analysis_run_id: 'run-1' }, error: null }) })) })) })) })) })),
    }
    if (table === 'gpc_scisure_review_decisions') return { upsert: reviewUpsert }
    throw new Error(`Unexpected table ${table}`)
  })
  return reviewUpsert
}

describe('SciSure scientist review decision route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireSciSureOrigin.mockReturnValue('https://sandbox.scisure.test')
    mocks.authorizeConnection.mockResolvedValue({ admin: { from: mocks.from }, connection: { id: 'bridge-1', principal_id: 'principal-1', owner_user_id: 'user-1' } })
    mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) } })
  })

  it('binds an explicit approval to the completed job, source hash, and analysis revision using only reviewer_user_id', async () => {
    const reviewUpsert = db()
    const response = await POST(request({ recommendationId: 'rec-safe', decision: 'approved_for_experiment', sourceHash: 'a'.repeat(64), analysisRevision: null }), { params: Promise.resolve({ id: 'snapshot-1' }) })

    expect(response.status).toBe(200)
    expect(reviewUpsert).toHaveBeenCalledWith(expect.objectContaining({
      job_id: 'job-1', recommendation_id: 'rec-safe', reviewer_user_id: 'user-1', decision: 'approved_for_experiment',
    }), { onConflict: 'job_id,recommendation_id' })
    const write = reviewUpsert.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(write[0]).not.toHaveProperty('reviewer_principal_id')
  })

  it('rejects a cross-site request before it writes a scientist decision', async () => {
    const reviewUpsert = db()
    const response = await POST(request({ recommendationId: 'rec-safe', decision: 'approved_for_experiment', sourceHash: 'a'.repeat(64), analysisRevision: null }, 'https://attacker.test'), { params: Promise.resolve({ id: 'snapshot-1' }) })

    expect(response.status).toBe(403)
    expect(reviewUpsert).not.toHaveBeenCalled()
  })

  it('rejects decisions for a result that is not currently eligible', async () => {
    const reviewUpsert = db()
    const response = await POST(request({ recommendationId: 'rec-safe', decision: 'approved_for_experiment', sourceHash: 'b'.repeat(64), analysisRevision: null }), { params: Promise.resolve({ id: 'snapshot-1' }) })

    expect(response.status).toBe(400)
    expect(reviewUpsert).not.toHaveBeenCalled()
  })
})
