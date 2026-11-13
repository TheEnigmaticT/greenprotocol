import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ batch: vi.fn(), score: vi.fn(), available: vi.fn(), auth: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.auth } }) }))
vi.mock('@/lib/chemistry-service', () => ({ batchConvert: mocks.batch, scoreProtocol: mocks.score, isServiceAvailable: mocks.available }))
import { POST } from '@/app/api/rescore/route'

function input() {
  return { analysis: {
    steps: [5, 20].map((amount, index) => ({ stepNumber: index + 1, description: `Use ${amount} mL water.`, conditions: {}, chemicals: [{ name: 'water', role: 'solvent', processUse: index ? 'wash' : 'reaction', quantity: `${amount} mL`, quantityKg: 99 }] })),
    recommendations: [],
  } }
}
function converted(amount: number) {
  return { chemical_name: 'water', input_quantity: `${amount} mL`, quantity_kg: amount / 1000, quantity_g: amount, quantity_mol: amount / 18, molecular_weight: 18, smiles: 'O', data_source: 'fixture', reference_status: 'available', ghs_hazards: [{ code: 'H319', description: 'Synthetic fixture only.', source: 'test' }] }
}

describe('rescore input honesty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ data: { user: { id: 'test-user' } }, error: null })
    mocks.available.mockResolvedValue(true)
    mocks.score.mockResolvedValue({ grade: 'INCOMPLETE', total_score: 0, max_possible: 0, scores: [] })
  })
  it('joins reordered conversions by occurrence and carries source quantities and hazard evidence', async () => {
    mocks.batch.mockResolvedValue({ results: [converted(20), converted(5)] })
    const response = await POST(new Request('http://localhost/api/rescore', { method: 'POST', body: JSON.stringify(input()) }))
    expect(response.status).toBe(200)
    expect(mocks.score.mock.calls[0][0].chemicals).toEqual([
      expect.objectContaining({ quantity_g: 5, quantity: '5 mL', reference_hcodes: ['H319'], process_use: 'reaction', smiles: 'O' }),
      expect.objectContaining({ quantity_g: 20, quantity: '20 mL', reference_hcodes: ['H319'], process_use: 'wash', smiles: 'O' }),
    ])
  })
  it('does not revive client/model masses when conversion fails', async () => {
    mocks.batch.mockResolvedValue(null)
    await POST(new Request('http://localhost/api/rescore', { method: 'POST', body: JSON.stringify(input()) }))
    expect(mocks.score.mock.calls[0][0].chemicals).toEqual([
      expect.objectContaining({ quantity_g: null, quantity_kg: null, reference_status: 'unavailable' }),
      expect.objectContaining({ quantity_g: null, quantity_kg: null, reference_status: 'unavailable' }),
    ])
  })
})
