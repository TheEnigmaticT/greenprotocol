import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: { id: 'owner-1' } as { id: string } | null,
  batchConvert: vi.fn(),
  scoreProtocol: vi.fn(),
  isServiceAvailable: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) },
}) }))
vi.mock('@/lib/chemistry-service', () => ({
  batchConvert: mocks.batchConvert,
  scoreProtocol: mocks.scoreProtocol,
  isServiceAvailable: mocks.isServiceAvailable,
}))

import { POST } from '@/app/api/rescore/route'

const analysis = {
  protocolTitle: 'Rescore identity fixture',
  chemistrySubdomain: 'synthetic',
  steps: [{
    stepNumber: 1,
    description: 'Add DMF and Pd(PPh3)4.',
    chemicals: [
      { name: 'DMF', role: 'solvent', quantity: '73.09 g', quantityKg: 0.07309 },
      { name: 'Pd(PPh3)4', role: 'catalyst', quantity: '11.5556 mg', quantityKg: 0.0000115556 },
    ],
    conditions: {},
  }],
  recommendations: [],
}

function request(value: unknown) {
  return new Request('http://localhost/api/rescore', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analysis: value }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = { id: 'owner-1' }
  mocks.isServiceAvailable.mockResolvedValue(true)
  mocks.scoreProtocol.mockResolvedValue({ grade: 'B', total_score: 20, max_possible: 120, scores: [], smiles_extraction: {}, yield_extraction: {} })
})

describe('POST /api/rescore', () => {
  it('uses echoed request identities to align reordered canonical aliases without changing submitted names', async () => {
    mocks.batchConvert.mockResolvedValue({ results: [
      { request_id: '1:1', requested_chemical_name: 'Pd(PPh3)4', chemical_name: 'Tetrakis(triphenylphosphine)palladium(0)', molecular_weight: 1155.56, quantity_g: 0.0115556, quantity_kg: 0.0000115556, quantity_mol: 0.00001 },
      { request_id: '1:0', requested_chemical_name: 'DMF', chemical_name: 'N,N-Dimethylformamide', molecular_weight: 73.09, quantity_g: 73.09, quantity_kg: 0.07309, quantity_mol: 1 },
    ] })

    const response = await POST(request(analysis))

    expect(response.status).toBe(200)
    expect(mocks.batchConvert).toHaveBeenCalledWith([
      { name: 'DMF', quantity: '73.09 g', requestId: '1:0' },
      { name: 'Pd(PPh3)4', quantity: '11.5556 mg', requestId: '1:1' },
    ])
    expect(mocks.scoreProtocol).toHaveBeenCalledWith(expect.objectContaining({ chemicals: [
      expect.objectContaining({ name: 'DMF', quantity_mol: 1, molecular_weight: 73.09 }),
      expect.objectContaining({ name: 'Pd(PPh3)4', quantity_mol: 0.00001, molecular_weight: 1155.56 }),
    ] }))
  })

  it('rejects an accepted supported replacement when no scenario-specific replacement quantity exists', async () => {
    const supported = {
      ...analysis,
      recommendations: [{
        stepNumber: 1, isAccepted: true, kind: 'chemical_swap',
        original: { chemical: 'DMF', issue: 'hazard' }, alternative: { chemical: 'Cyrene', rationale: 'candidate' },
        applicationEligibility: { status: 'supported', reason: 'fixture evidence' },
      }],
    }

    const response = await POST(request(supported))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ error: 'Replacement scenario quantities are required before rescoring' })
    expect(mocks.batchConvert).not.toHaveBeenCalled()
    expect(mocks.scoreProtocol).not.toHaveBeenCalled()
  })

  it('does not replace materials for accepted unsupported swaps or process tips', async () => {
    mocks.batchConvert.mockResolvedValue({ results: [
      { request_id: '1:0', requested_chemical_name: 'DMF', chemical_name: 'N,N-Dimethylformamide', molecular_weight: 73.09, quantity_g: 73.09, quantity_kg: 0.07309, quantity_mol: 1 },
      { request_id: '1:1', requested_chemical_name: 'Pd(PPh3)4', chemical_name: 'Tetrakis(triphenylphosphine)palladium(0)', molecular_weight: 1155.56, quantity_g: 0.0115556, quantity_kg: 0.0000115556, quantity_mol: 0.00001 },
    ] })
    const notApplicable = {
      ...analysis,
      recommendations: [
        { stepNumber: 1, isAccepted: true, kind: 'chemical_swap', original: { chemical: 'DMF', issue: 'hazard' }, alternative: { chemical: 'Cyrene', rationale: 'candidate' }, applicationEligibility: { status: 'withheld', reason: 'not enough evidence' } },
        { stepNumber: 1, isAccepted: true, kind: 'process_change', original: { chemical: 'Pd(PPh3)4', issue: 'loading' }, alternative: { chemical: 'reduce catalyst loading', rationale: 'tip' }, applicationEligibility: { status: 'supported', reason: 'not a swap' } },
      ],
    }

    const response = await POST(request(notApplicable))

    expect(response.status).toBe(200)
    expect(mocks.batchConvert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: 'DMF' }), expect.objectContaining({ name: 'Pd(PPh3)4' }),
    ]))
    expect(mocks.batchConvert).not.toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ name: 'Cyrene' }), expect.objectContaining({ name: 'reduce catalyst loading' }),
    ]))
  })
})
