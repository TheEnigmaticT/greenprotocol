import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: { id: 'owner-1' } as { id: string } | null,
  scenario: 'success' as 'success' | 'wrong-owner' | 'revision-conflict',
  writes: [] as Record<string, unknown>[],
  eqCalls: [] as [string, unknown][],
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) },
  from(table: string) {
    if (table !== 'gpc_analyses') throw new Error(`unexpected table: ${table}`)
    let updateAttempted = false
    const query = {
      update: vi.fn((value: Record<string, unknown>) => {
        updateAttempted = true
        mocks.writes.push(value)
        return query
      }),
      select: vi.fn(() => query),
      eq: vi.fn((field: string, value: unknown) => {
        mocks.eqCalls.push([field, value])
        return query
      }),
      maybeSingle: vi.fn(async () => {
        if (updateAttempted) {
          return mocks.scenario === 'success'
            ? { data: { id: 'analysis-1', revision_number: 8 }, error: null }
            : { data: null, error: null }
        }
        // The conflict lookup distinguishes ownership from a revision miss.
        return mocks.scenario === 'revision-conflict'
          ? { data: { id: 'analysis-1' }, error: null }
          : { data: null, error: null }
      }),
    }
    return query
  },
}) }))

import { PATCH } from '@/app/api/analyses/[id]/route'

const validAnalysis = {
  protocolTitle: 'Persisted acceptance fixture',
  chemistrySubdomain: 'synthetic',
  steps: [{
    stepNumber: 1,
    description: 'Extract product.',
    chemicals: [{ name: 'dichloromethane', role: 'solvent', quantity: '25 mL', quantityMl: 25, quantityKg: 0.033 }],
    conditions: { temperature: null, duration: null, atmosphere: null },
  }],
  recommendations: [{
    stepNumber: 1,
    kind: 'chemical_swap',
    original: { chemical: 'dichloromethane', issue: 'hazardous solvent' },
    alternative: { chemical: 'ethyl acetate', rationale: 'candidate' },
    applicationEligibility: { status: 'supported', reason: 'Fixture evidence.' },
    isAccepted: true,
  }],
}

function request(analysis_result: unknown, expected_revision_number = 7) {
  return new Request('http://localhost/api/analyses/analysis-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis_result, expected_revision_number }),
  })
}

const context = { params: Promise.resolve({ id: 'analysis-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = { id: 'owner-1' }
  mocks.scenario = 'success'
  mocks.writes.length = 0
  mocks.eqCalls.length = 0
})

describe('PATCH /api/analyses/[id] — unit', () => {
  it('rejects an inventory-incompatible analysis_result before database writes', async () => {
    const response = await PATCH(request({ protocolTitle: 'missing arrays' }), context)

    expect(response.status).toBe(400)
    expect(mocks.writes).toEqual([])
  })

  it('persists an unavailable accepted impact inventory with the accepted analysis', async () => {
    const response = await PATCH(request(validAnalysis), context)

    expect(response.status).toBe(200)
    expect(mocks.writes).toHaveLength(1)
    expect(mocks.writes[0]).toMatchObject({
      analysis_result: validAnalysis,
      revision_number: 8,
      impact_delta: {
        assessment: { level: 'unavailable' },
        inventory: {
          version: 'impact-inventory/v1',
          afterRows: [expect.objectContaining({ scenario: 'accepted', chemical: 'ethyl acetate', quantity: { state: 'unknown' } })],
        },
      },
    })
  })

  it('retains authentication ahead of validation and database writes', async () => {
    mocks.user = null
    const response = await PATCH(request({ protocolTitle: 'still malformed' }), context)

    expect(response.status).toBe(401)
    expect(mocks.writes).toEqual([])
  })

  it('retains owner-scoped updates when another user owns the analysis', async () => {
    mocks.scenario = 'wrong-owner'
    const response = await PATCH(request(validAnalysis), context)

    expect(response.status).toBe(404)
    expect(mocks.writes).toHaveLength(1)
    expect(mocks.eqCalls).toContainEqual(['user_id', 'owner-1'])
  })

  it('retains optimistic revision conflict handling', async () => {
    mocks.scenario = 'revision-conflict'
    const response = await PATCH(request(validAnalysis), context)

    expect(response.status).toBe(409)
    expect(mocks.writes).toHaveLength(1)
  })
})
