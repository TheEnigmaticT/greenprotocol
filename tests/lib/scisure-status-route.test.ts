import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Recommendation } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  authorizeConnection: vi.fn(),
  requireSciSureOrigin: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/integrations/scisure/server', () => ({
  authorizeConnection: mocks.authorizeConnection,
  requireSciSureOrigin: mocks.requireSciSureOrigin,
}))

import { GET } from '@/app/api/integrations/scisure/snapshots/[id]/status/route'

const recommendation: Recommendation = {
  id: 'rec-safe', stepNumber: 3, principleNumbers: [5], principleNames: ['Safer solvents'], severity: 'high',
  original: { chemical: 'N,N-Dimethylformamide', issue: 'Hazardous solvent' },
  alternative: { chemical: 'Ethyl acetate', rationale: 'Lower hazard', yieldImpact: 'Validate experimentally', caveats: 'Confirm compatibility before use.', evidenceBasis: 'Direct literature support' },
  confidenceLevel: 'medium', cardKind: 'swap', isAccepted: false,
  evidenceAssessment: { disposition: 'supported_applicable', directness: 'direct', supportingReferenceCount: 1, applicability: 'strong', eligibleForApplication: true, eligibilityReason: 'Direct evidence supports this exact intervention.' },
}

function request() {
  return new Request('http://localhost:3000/api/integrations/scisure/snapshots/snapshot-1/status', {
    headers: { authorization: 'Bearer bridge-secret', 'x-gcai-bridge-session': 'bridge-1', 'x-gcai-scisure-origin': 'https://sandbox.scisure.test' },
  })
}

function db(decision: 'approved_for_experiment' | 'rejected' | null) {
  const decisionSelect = vi.fn(() => ({ eq: vi.fn(() => ({ data: decision ? [{ recommendation_id: 'rec-safe', decision }] : [], error: null })) }))
  mocks.from.mockImplementation((table: string) => {
    if (table === 'gpc_external_source_snapshots') return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'snapshot-1', source_hash: 'a'.repeat(64), source: { selection: [{ stepId: 'prot-step-3', order: 3 }] } }, error: null }) })) })) })) }
    if (table === 'gpc_scisure_jobs') return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(() => ({ limit: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'job-1', status: 'completed', analysis_id: null, analysis_run_id: null, result: { recommendations: [recommendation] } }, error: null }) })) })) })) })) })) }
    if (table === 'gpc_scisure_review_decisions') return { select: decisionSelect }
    throw new Error(`Unexpected table ${table}`)
  })
  return decisionSelect
}

describe('SciSure status route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireSciSureOrigin.mockReturnValue('https://sandbox.scisure.test')
    mocks.authorizeConnection.mockResolvedValue({ admin: { from: mocks.from }, connection: { id: 'bridge-1', principal_id: 'principal-1' } })
  })

  it('returns a real eligible recommendation as proposed before scientist review', async () => {
    db(null)
    const response = await GET(request(), { params: Promise.resolve({ id: 'snapshot-1' }) })
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.recommendations).toMatchObject([{ recommendationId: 'rec-safe', sourceStepId: 'prot-step-3', originalChemical: 'N,N-Dimethylformamide', decision: 'proposed' }])
  })

  it('overlays only the durable scientist decision rather than the engine isAccepted flag', async () => {
    const decisionSelect = db('approved_for_experiment')
    const response = await GET(request(), { params: Promise.resolve({ id: 'snapshot-1' }) })
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.recommendations).toMatchObject([{ recommendationId: 'rec-safe', decision: 'accepted' }])
    expect(decisionSelect).toHaveBeenCalledWith('recommendation_id, decision')
  })
})
