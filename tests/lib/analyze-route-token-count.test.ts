import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  analyzeProtocol: vi.fn(),
  anthropicConstructors: vi.fn(),
  anthropicCountTokens: vi.fn(),
  auditInsert: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  notifyAnalysis: vi.fn(),
  protocolFingerprint: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { countTokens: mocks.anthropicCountTokens }

    constructor() {
      mocks.anthropicConstructors()
    }
  },
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/chemicals', () => ({ findChemical: vi.fn() }))
vi.mock('@/lib/equivalencies', () => ({ calculateEquivalencies: vi.fn() }))
vi.mock('@/lib/pipeline', () => ({
  analyzeProtocol: mocks.analyzeProtocol,
  NotChemistryError: class NotChemistryError extends Error {},
}))
vi.mock('@/lib/version', () => ({ getAnalysisMetadata: vi.fn() }))
vi.mock('@/lib/scoring-snapshot', () => ({
  buildCanonicalScoringSnapshot: vi.fn(),
  protocolFingerprint: mocks.protocolFingerprint,
}))
vi.mock('@/lib/operational-alerts', () => ({ notifyAnalysis: mocks.notifyAnalysis }))

import { POST } from '@/app/api/analyze/route'

function configuredSupabase() {
  const analysisRunUpdate = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })),
  }))

  mocks.from.mockImplementation((table: string) => {
    if (table === 'gpc_analyses') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
        })),
      }
    }

    if (table === 'gpc_analysis_runs') {
      return {
        insert: mocks.auditInsert.mockImplementation(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null }),
          })),
        })),
        update: analysisRunUpdate,
      }
    }

    if (table === 'gpc_analysis_traces') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      }
    }

    throw new Error(`Unexpected table: ${table}`)
  })

  mocks.createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'chemist@example.test' } },
        error: null,
      }),
    },
    from: mocks.from,
  })
}

function request() {
  return new Request('http://localhost/api/analyze', {
    method: 'POST',
    body: JSON.stringify({ protocolText: 'Add water slowly and stir for thirty minutes.' }),
  })
}

describe('analyze route protocol token audit', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('GCAI_ENGINE_CANDIDATE', '1')
    vi.stubEnv('ANTHROPIC_API_KEY', 'legacy-key-must-not-be-used')
    vi.clearAllMocks()
    configuredSupabase()
    mocks.protocolFingerprint.mockResolvedValue('fingerprint-1')
    mocks.notifyAnalysis.mockResolvedValue(undefined)
    mocks.analyzeProtocol.mockRejectedValue(new Error('candidate provider unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('records a nullable audit token count without constructing Anthropic for a selected candidate', async () => {
    const response = await POST(request())
    await response.text()

    expect(response.status).toBe(200)
    expect(mocks.anthropicConstructors).not.toHaveBeenCalled()
    expect(mocks.anthropicCountTokens).not.toHaveBeenCalled()
    expect(mocks.auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      protocol_input_tokens: null,
    }))
  })

  it('does not send Claude-specific authentication guidance for candidate failures', async () => {
    mocks.analyzeProtocol.mockRejectedValue(Object.assign(new Error('API key rejected'), { status: 401 }))

    const response = await POST(request())
    const body = await response.text()

    expect(body).not.toContain('Anthropic API key')
    expect(body).not.toContain('ANTHROPIC_API_KEY')
  })
})
