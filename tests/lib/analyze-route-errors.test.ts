import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  analyzeProtocol: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  reserveRun: vi.fn(),
  analysesInsert: vi.fn(),
  notifyAnalysis: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({ default: class MockAnthropic { messages = { countTokens: vi.fn() } } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/chemicals', () => ({ findChemical: vi.fn() }))
vi.mock('@/lib/equivalencies', () => ({ calculateEquivalencies: vi.fn() }))
vi.mock('@/lib/pipeline', () => ({
  analyzeProtocol: mocks.analyzeProtocol,
  NotChemistryError: class NotChemistryError extends Error {},
}))
vi.mock('@/lib/version', () => ({ getAnalysisMetadata: vi.fn() }))
vi.mock('@/lib/scoring-snapshot', () => ({
  buildCanonicalScoringSnapshot: vi.fn(),
  protocolFingerprint: vi.fn().mockResolvedValue('fingerprint-1'),
}))
vi.mock('@/lib/operational-alerts', () => ({ notifyAnalysis: mocks.notifyAnalysis }))

import { POST } from '@/app/api/analyze/route'
import { AnalysisError } from '@/lib/errors/classify'
import { MAX_PROTOCOL_CHARS } from '@/lib/protocol-limits'

const PROTOCOL = 'Add water slowly and stir for thirty minutes.'
const INTERNALS = /ANTHROPIC|API_KEY|Anthropic|Claude|stop_reason|tool_use|duplicate key|violates|quota exhausted|gpc_|Postgres|undefined/

function configureSupabase() {
  const chain = (result: unknown) => ({ eq: vi.fn(() => chain(result)), then: (resolve: (value: unknown) => void) => resolve(result) })
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'chemist@example.test' } }, error: null }) },
    from: vi.fn((table: string) => {
      if (table === 'gpc_analyses') {
        return { insert: mocks.analysesInsert.mockImplementation(() => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: { message: 'duplicate key value violates unique constraint "gpc_analyses_pkey"' } }) }) })) }
      }
      if (table === 'gpc_analysis_runs') return { update: vi.fn(() => chain({ error: null })) }
      if (table === 'gpc_analysis_traces') return { select: vi.fn(() => chain({ data: [], error: null })) }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })
  mocks.createAdminClient.mockReturnValue({ rpc: mocks.reserveRun })
}

function post(protocolText: unknown) {
  return POST(new Request('http://localhost/api/analyze', { method: 'POST', body: JSON.stringify({ protocolText }) }))
}

describe('analyze route error contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('GCAI_ENGINE_CANDIDATE', '1')
    configureSupabase()
    mocks.reserveRun.mockResolvedValue({ data: 'run-1', error: null })
    mocks.notifyAnalysis.mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('reports the real run limit with a stable code when the quota is exhausted', async () => {
    mocks.reserveRun.mockResolvedValue({ data: null, error: { message: 'gpc_reserve_registered_analysis_run: quota exhausted for user-1' } })

    const response = await post(PROTOCOL)
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toMatchObject({ code: 'run_limit_reached', limit: 10 })
    expect(JSON.stringify(body)).not.toMatch(INTERNALS)
    expect(mocks.analyzeProtocol).not.toHaveBeenCalled()
  })

  it('hides the database message when capacity cannot be reserved for another reason', async () => {
    mocks.reserveRun.mockResolvedValue({ data: null, error: { message: 'connection to server at "db.internal" failed' } })

    const response = await post(PROTOCOL)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.code).toBe('quota_unavailable')
    expect(JSON.stringify(body)).not.toContain('db.internal')
  })

  it('rejects an over-long procedure before it reaches the model, with the limit and its length', async () => {
    const response = await post('x'.repeat(MAX_PROTOCOL_CHARS + 1))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({ code: 'protocol_too_long', maxChars: MAX_PROTOCOL_CHARS, actualChars: MAX_PROTOCOL_CHARS + 1 })
    expect(mocks.reserveRun).not.toHaveBeenCalled()
    expect(mocks.analyzeProtocol).not.toHaveBeenCalled()
  })

  it('accepts a procedure of exactly the maximum length', async () => {
    mocks.analyzeProtocol.mockRejectedValue(new Error('stop here'))
    const response = await post('x'.repeat(MAX_PROTOCOL_CHARS))
    await response.text()
    expect(response.status).toBe(200)
  })

  it('reports a too-short procedure with the count it received', async () => {
    const response = await post('  short  ')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'protocol_too_short', minChars: 20, actualChars: 5 })
  })

  it('rejects a body without protocol text as an invalid request', async () => {
    const response = await post(42)
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('invalid_request')
  })

  it.each([
    ['a rejected provider key', Object.assign(new Error('401 invalid x-api-key: sk-ant-secret'), { status: 401 }), 'provider_auth'],
    ['a provider rate limit', Object.assign(new Error('429 rate_limit_error'), { status: 429 }), 'provider_rate_limit'],
    ['a pipeline that produced nothing usable', new AnalysisError('analysis_incomplete', 'Claude did not return a tool_use block for parse (stop_reason=max_tokens)'), 'analysis_incomplete'],
    ['an unexpected exception', new Error('Cannot read properties of undefined (reading steps)'), 'unknown'],
  ])('streams a coded, plain-language error for %s and keeps the raw detail server-side', async (_label, thrown, code) => {
    mocks.analyzeProtocol.mockRejectedValue(thrown)

    const response = await post(PROTOCOL)
    const stream = await response.text()
    const event = JSON.parse(stream.split('\n').find(line => line.startsWith('data: '))!.slice(6))

    expect(event).toMatchObject({ type: 'error', code })
    expect(stream).not.toMatch(INTERNALS)
    expect(stream).not.toContain('sk-ant-secret')
    expect(mocks.notifyAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      errorMessages: code === 'provider_rate_limit' ? [] : [(thrown as Error).message],
    }))
  })

  it('does not leak Postgres text when saving the finished analysis fails', async () => {
    mocks.analyzeProtocol.mockResolvedValue({ protocolTitle: 'Water', steps: [], recommendations: [] })

    const response = await post(PROTOCOL)
    const stream = await response.text()

    expect(stream).toContain('"code":"persist_failed"')
    expect(stream).not.toMatch(INTERNALS)
    expect(mocks.notifyAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      errorMessages: ['duplicate key value violates unique constraint "gpc_analyses_pkey"'],
    }))
  })
})
