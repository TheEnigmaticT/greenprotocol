import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  countTokens: vi.fn().mockResolvedValue({ input_tokens: 99 }),
  analyze: vi.fn(),
  notify: vi.fn().mockResolvedValue(undefined),
  user: { id: 'synthetic-user', email: 'synthetic@greenchemistry.ai' } as { id: string; email: string } | null,
  writes: [] as { table: string; value: Record<string, unknown> }[],
}))
vi.mock('@anthropic-ai/sdk', () => ({ default: class {
  messages = { countTokens: mocks.countTokens }
} }))
vi.mock('@/lib/pipeline', () => ({
  analyzeProtocol: mocks.analyze,
  NotChemistryError: class NotChemistryError extends Error {},
}))
vi.mock('@/lib/operational-alerts', () => ({ notifyAnalysis: mocks.notify }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) },
  from(table: string) {
    const result = Promise.resolve({ data: table === 'gpc_analysis_traces' ? [] : null, error: null })
    const query = {
      select: vi.fn(), eq: vi.fn(), update: vi.fn(), insert: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: { id: table === 'gpc_analyses' ? 'synthetic-analysis' : 'synthetic-run' }, error: null }),
      then: result.then.bind(result),
    }
    for (const method of ['select', 'eq', 'update'] as const) query[method].mockReturnValue(query)
    query.insert.mockImplementation((value: Record<string, unknown>) => {
      mocks.writes.push({ table, value })
      return query
    })
    return query
  },
}) }))

import { POST } from '../../app/api/analyze/route'

function request(text = 'Synthetic protocol\r\nPreserve its exact source text.') {
  return new Request('http://localhost/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocolText: text }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.writes.length = 0
  mocks.user = { id: 'synthetic-user', email: 'synthetic@greenchemistry.ai' }
  mocks.analyze.mockResolvedValue({ steps: [], recommendations: [], protocolTitle: 'Synthetic test' })
})

describe('analysis endpoint provider-independent bookkeeping', () => {
  it('does not send the private protocol to Anthropic merely to count tokens', async () => {
    const response = await POST(request())
    const stream = await response.text()
    expect(response.status).toBe(200)
    expect(stream).toContain('synthetic-analysis')
    expect(mocks.countTokens).not.toHaveBeenCalled()
    expect(mocks.writes.find(w => w.table === 'gpc_analysis_runs')?.value.protocol_input_tokens).toBeNull()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ protocolInputTokens: null }))
  })

  it('preserves the exact source through pipeline and persistence', async () => {
    const source = 'Synthetic protocol\r\n  Preserve trailing whitespace.  '
    await (await POST(request(source))).text()
    expect(mocks.analyze).toHaveBeenCalledWith(source, expect.any(Function), expect.any(Object))
    expect(mocks.writes.find(w => w.table === 'gpc_analyses')?.value.protocol_text).toBe(source)
  })

  it('persists unavailable impact rather than inventing same-mass substitution savings', async () => {
    mocks.analyze.mockResolvedValue({
      protocolTitle: 'Synthetic impact test',
      steps: [{
        stepNumber: 1,
        description: 'Extract with dichloromethane.',
        chemicals: [{ name: 'dichloromethane', role: 'solvent', quantityKg: 1, quantityMl: null }],
      }],
      recommendations: [{
        stepNumber: 1,
        principleNumbers: [5],
        principleNames: ['Safer Solvents'],
        severity: 'high',
        kind: 'chemical_swap',
        original: { chemical: 'dichloromethane', issue: 'hazardous solvent' },
        alternative: { chemical: 'ethyl acetate', rationale: 'candidate', yieldImpact: '', caveats: '', evidenceBasis: '' },
        confidenceLevel: 'medium',
        applicationEligibility: { status: 'supported', reason: 'Synthetic supported fixture.' },
      }],
    })

    await (await POST(request())).text()

    const impact = mocks.writes.find(w => w.table === 'gpc_analyses')?.value.impact_delta as Record<string, unknown>
    expect(impact.assessment).toMatchObject({ level: 'unavailable' })
    expect(impact.co2eSavedKg).toBe(0)
    const inventory = impact.inventory as { version: string; baselineRows: unknown[]; afterRows: unknown[] }
    expect(inventory.version).toBe('impact-inventory/v1')
    expect(inventory.baselineRows).toMatchObject([
      { chemical: 'dichloromethane', quantity: { state: 'known', massKg: 1 } },
    ])
    expect(inventory.afterRows).toMatchObject([
      { chemical: 'ethyl acetate', quantity: { state: 'unknown' }, originalChemical: 'dichloromethane' },
    ])
    expect((impact.assessment as { reasons: string[] }).reasons).toContain(
      'Replacement quantity for dichloromethane → ethyl acetate has not been provided; original mass was not reused.',
    )
    expect(mocks.writes.find(w => w.table === 'gpc_analyses')?.value.analysis_result).toMatchObject({
      impactInventory: { version: 'impact-inventory/v1' },
    })
  })

  it('persists only model-extracted inventory quantities rather than a later density conversion', async () => {
    mocks.analyze.mockResolvedValue({
      protocolTitle: 'Synthetic volume-only impact test',
      steps: [{
        stepNumber: 1,
        description: 'Extract with dichloromethane.',
        chemicals: [{ name: 'dichloromethane', role: 'solvent', quantity: '25 mL', quantityKg: null, quantityMl: 25 }],
      }],
      recommendations: [],
    })

    await (await POST(request())).text()

    const impact = mocks.writes.find(w => w.table === 'gpc_analyses')?.value.impact_delta as {
      inventory: { baselineRows: { quantity: { massKg?: number; volumeMl?: number }; provenance: string[] }[] }
    }
    expect(impact.inventory.baselineRows[0]).toMatchObject({
      quantity: { state: 'known', volumeMl: 25 },
      provenance: expect.arrayContaining(['model_extracted_protocol']),
    })
    expect(impact.inventory.baselineRows[0].quantity.massKg).toBeUndefined()
  })

  it('keeps authentication ahead of analysis and bookkeeping', async () => {
    mocks.user = null
    expect((await POST(request())).status).toBe(401)
    expect(mocks.countTokens).not.toHaveBeenCalled()
    expect(mocks.analyze).not.toHaveBeenCalled()
    expect(mocks.writes).toEqual([])
  })

  it.each([
    [401, 'Analysis provider authentication failed.'],
    [429, 'Rate limited by the analysis provider. Please wait a moment and try again.'],
  ])('reports provider-neutral errors for status %s', async (status, message) => {
    mocks.analyze.mockRejectedValueOnce(Object.assign(new Error('Synthetic provider error'), { status }))
    const stream = await (await POST(request())).text()
    expect(stream).toContain(message)
    expect(stream).not.toMatch(/Anthropic|Claude|ANTHROPIC_API_KEY/)
  })
})
