import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildScoringInputManifest,
  type ScoringInputManifest,
} from '@/lib/scoring-input-manifest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

const CURRENT_METHODOLOGY = 'honest-inputs-v1'

const STORED_SOURCE = 'Add 5 mL dichloromethane and stir 10 min.'

function buildStoredManifest(): ScoringInputManifest {
  return buildScoringInputManifest({
    sourceText: STORED_SOURCE,
    request: {
      chemicals: [{ name: 'dichloromethane', role: 'solvent', step_number: 1, reference_status: 'resolved' }],
      steps: [{ stepNumber: 1, description: 'Mix', chemicals: [], conditions: {} }],
      protocol_text: STORED_SOURCE,
    } as unknown as Parameters<typeof buildScoringInputManifest>[0]['request'],
    scores: {
      scores: [],
      total_score: 7,
      max_possible: 10,
      grade: 'B',
      smiles_extraction: {},
      yield_extraction: {},
    },
    references: [],
    warnings: [],
    provenance: {
      methodologyVersion: CURRENT_METHODOLOGY,
      model: 'claude-3',
      promptHash: 'p',
      schemaHash: 's',
      webRevision: null,
    },
  })
}

function baseResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolTitle: 'p',
    chemistrySubdomain: 's',
    steps: [],
    recommendations: [],
    revisedProtocol: '',
    overallAssessment: {
      greenPrinciplesViolated: [],
      mostImpactfulChange: '',
      experimentalValidationNeeded: false,
      disclaimer: '',
    },
    ...overrides,
  }
}

function patchResult(
  body: { analysis_result: unknown; expected_revision_number: number },
) {
  return new Request('http://localhost/api/analyses/a-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type Patcher = typeof import('@/app/api/analyses/[id]/route').PATCH

async function patch(req: Request, id: string): Promise<Response> {
  const mod = await import('@/app/api/analyses/[id]/route')
  const PATCH = mod.PATCH as Patcher
  return PATCH(req, { params: Promise.resolve({ id }) })
}

interface SupabaseState {
  user?: { id: string; email: string } | null
  authError?: { message: string } | null
  row?: { analysis_result: unknown; revision_number: number } | null
  selectError?: { message: string } | null
  updateResult?: { data: { id: string; revision_number: number } | null; error: { message: string } | null }
}

function configureSupabase(state: SupabaseState) {
  const user = 'user' in state ? state.user : { id: 'user-1', email: 'chemist@example.test' }
  const row = 'row' in state ? state.row : null
  const selectError = state.selectError ?? null
  const update = state.updateResult ?? { data: { id: 'a-1', revision_number: 2 }, error: null }

  const updateMaybeSingle = vi.fn().mockResolvedValue(update)
  const updateSingle = vi.fn().mockResolvedValue(update)
  const updateSelect = vi.fn(() => ({ maybeSingle: updateMaybeSingle, single: updateSingle }))
  const updateEq = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: updateSelect }) }) })
  const updateFn = vi.fn(() => ({ eq: updateEq }))

  const selectSingle = vi.fn().mockResolvedValue({ data: row, error: selectError })
  const selectMaybeSingle = vi.fn().mockResolvedValue({ data: row, error: selectError })
  const innerEq = vi.fn().mockReturnValue({ single: selectSingle, maybeSingle: selectMaybeSingle })
  const selectChain = vi.fn(() => ({ eq: innerEq }))
  const selectFn = vi.fn(() => ({ eq: selectChain }))

  const fromFn = vi.fn((table: string) => {
    if (table !== 'gpc_analyses') throw new Error(`Unexpected table: ${table}`)
    return {
      select: selectFn,
      update: updateFn,
    }
  })

  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: state.authError ?? null }) },
    from: fromFn,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PATCH /api/analyses/[id] — immutable manifest preservation', () => {
  it('preserves the stored scoringInputManifest when the client omits it (ordinary card-update)', async () => {
    const storedManifest = buildStoredManifest()
    const currentResult = baseResult({ scoringInputManifest: storedManifest })
    configureSupabase({
      row: { analysis_result: currentResult, revision_number: 1 },
      updateResult: { data: { id: 'a-1', revision_number: 2 }, error: null },
    })

    // Client sends a new analysis_result WITHOUT scoringInputManifest (e.g., accept/reject a card)
    const nextResult = baseResult({
      recommendations: [
        {
          id: 'rec-1',
          stepNumber: 1,
          principleNumbers: [1],
          principleNames: ['Prevent Waste'],
          severity: 'medium',
          original: { chemical: 'dichloromethane', issue: 'toxic' },
          alternative: { chemical: 'ethanol', rationale: 'safer', yieldImpact: 'low', caveats: 'none', evidenceBasis: 'low' },
          confidenceLevel: 'high',
          isAccepted: true,
        },
      ],
    })

    const response = await patch(
      patchResult({ analysis_result: nextResult, expected_revision_number: 1 }),
      'a-1',
    )

    expect(response.status).toBe(200)
    expect((await response.json())).toEqual({ success: true, revisionNumber: 2 })

    const supabase = await mocks.createClient.mock.results[0].value
    const updateCall = supabase.from.mock.results[0]?.value?.update?.mock?.calls?.[0]?.[0]
    expect(updateCall.analysis_result.scoringInputManifest).toBeDefined()
    expect(updateCall.analysis_result.scoringInputManifest.sourceHash).toBe(storedManifest.sourceHash)
    expect(updateCall.analysis_result.scoringInputManifest.digest).toBe(storedManifest.digest)
    // Caller's card-update recommendations are intact
    expect(updateCall.analysis_result.recommendations).toEqual(nextResult.recommendations)
    // CAS race behavior preserved: revision_number incremented and the WHERE includes expectedRevisionNumber
    expect(updateCall.revision_number).toBe(2)
  })

  it('accepts a client-provided scoringInputManifest that is structurally identical to the stored one', async () => {
    const storedManifest = buildStoredManifest()
    const currentResult = baseResult({ scoringInputManifest: storedManifest })
    configureSupabase({
      row: { analysis_result: currentResult, revision_number: 1 },
      updateResult: { data: { id: 'a-1', revision_number: 2 }, error: null },
    })

    // Client round-trips the SAME manifest back (e.g., they read it from GET and echo it)
    const nextResult = baseResult({ scoringInputManifest: structuredClone(JSON.parse(JSON.stringify(storedManifest))) })

    const response = await patch(
      patchResult({ analysis_result: nextResult, expected_revision_number: 1 }),
      'a-1',
    )
    expect(response.status).toBe(200)
    const supabase = await mocks.createClient.mock.results[0].value
    const updateCall = supabase.from.mock.results[0]?.value?.update?.mock?.calls?.[0]?.[0]
    expect(updateCall.analysis_result.scoringInputManifest.sourceHash).toBe(storedManifest.sourceHash)
  })

  it('rejects a client-provided scoringInputManifest that differs from the stored one (409)', async () => {
    const storedManifest = buildStoredManifest()
    const currentResult = baseResult({ scoringInputManifest: storedManifest })
    configureSupabase({
      row: { analysis_result: currentResult, revision_number: 1 },
      // No update happens — handler rejects before write
    })

    // Build a forged manifest with different scores
    const forgedManifest: ScoringInputManifest = buildScoringInputManifest({
      sourceText: STORED_SOURCE,
      request: {
        chemicals: [{ name: 'ethanol', role: 'solvent', step_number: 1, reference_status: 'resolved' }],
        steps: [{ stepNumber: 1, description: 'Mix', chemicals: [], conditions: {} }],
        protocol_text: STORED_SOURCE,
      } as unknown as Parameters<typeof buildScoringInputManifest>[0]['request'],
      scores: {
        scores: [],
        total_score: 99,
        max_possible: 100,
        grade: 'A',
        smiles_extraction: {},
        yield_extraction: {},
      },
      references: [],
      warnings: [],
      provenance: {
        methodologyVersion: CURRENT_METHODOLOGY,
        model: 'claude-3',
        promptHash: 'p',
        schemaHash: 's',
        webRevision: null,
      },
    })

    const nextResult = baseResult({ scoringInputManifest: forgedManifest })

    const response = await patch(
      patchResult({ analysis_result: nextResult, expected_revision_number: 1 }),
      'a-1',
    )
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('manifest_tamper_mismatch')
    expect(body.error).toMatch(/manifest/i)
    expect(JSON.stringify(body)).not.toMatch(/claude|ethanol|internal/i)

    const supabase = await mocks.createClient.mock.results[0].value
    expect(supabase.from.mock.results[0]?.value?.update).not.toHaveBeenCalled()
  })

  it('rejects a client-provided scoringInputManifest when no stored manifest exists (forgery attempt)', async () => {
    const currentResult = baseResult() // no stored manifest
    configureSupabase({ row: { analysis_result: currentResult, revision_number: 1 } })

    const forgedManifest = buildStoredManifest() // client tries to plant a manifest
    const nextResult = baseResult({ scoringInputManifest: forgedManifest })

    const response = await patch(
      patchResult({ analysis_result: nextResult, expected_revision_number: 1 }),
      'a-1',
    )
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('manifest_tamper_forged')

    const supabase = await mocks.createClient.mock.results[0].value
    expect(supabase.from.mock.results[0]?.value?.update).not.toHaveBeenCalled()
  })

  it('rejects a malformed scoringInputManifest (wrong schemaVersion)', async () => {
    const currentResult = baseResult()
    configureSupabase({ row: { analysis_result: currentResult, revision_number: 1 } })

    const nextResult = baseResult({
      scoringInputManifest: {
        schemaVersion: 99,
        sourceHash: 'a'.repeat(64),
        digest: 'b'.repeat(64),
        request: {},
        references: [],
        scores: { scores: [], total_score: 0, max_possible: 0, grade: 'A', smiles_extraction: {}, yield_extraction: {} },
        warnings: [],
        provenance: { methodologyVersion: 'x', model: 'x', promptHash: 'x', schemaHash: 'x', webRevision: null },
      },
    })

    const response = await patch(
      patchResult({ analysis_result: nextResult, expected_revision_number: 1 }),
      'a-1',
    )
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('manifest_shape_invalid')
  })

  it('returns 401 when the user is not authenticated', async () => {
    configureSupabase({ user: null, authError: { message: 'no session' } })
    const response = await patch(
      patchResult({ analysis_result: baseResult(), expected_revision_number: 1 }),
      'a-1',
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 404 when the analysis is not visible to the authenticated user (cross-owner)', async () => {
    // Real Supabase returns { data: null, error: null } when RLS / the WHERE
    // filters the row out — never an error message that might disclose
    // ownership of a record the caller does not own.
    configureSupabase({ row: null, selectError: null })
    const response = await patch(
      patchResult({ analysis_result: baseResult(), expected_revision_number: 1 }),
      'a-1',
    )
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toBe('Analysis not found')
    // Must not disclose ownership details
    expect(JSON.stringify(body)).not.toMatch(/other|cross|owner/i)
  })

  it('returns 409 when expected_revision_number does not match stored revision_number (CAS race preserved)', async () => {
    const storedManifest = buildStoredManifest()
    const currentResult = baseResult({ scoringInputManifest: storedManifest })
    configureSupabase({
      row: { analysis_result: currentResult, revision_number: 5 },
      // No update attempted — handler detects revision mismatch before write
    })

    const nextResult = baseResult({
      recommendations: [{ id: 'r1' }],
    })

    const response = await patch(
      patchResult({ analysis_result: nextResult, expected_revision_number: 1 }),
      'a-1',
    )
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('revision_mismatch')
    const supabase = await mocks.createClient.mock.results[0].value
    expect(supabase.from.mock.results[0]?.value?.update).not.toHaveBeenCalled()
  })

  it('returns 409 when the update CAS fails (someone else won the race)', async () => {
    const storedManifest = buildStoredManifest()
    const currentResult = baseResult({ scoringInputManifest: storedManifest })
    configureSupabase({
      row: { analysis_result: currentResult, revision_number: 1 },
      // CAS WHERE clause matched no rows: data is null but error is null.
      // The follow-up SELECT returns a row, so the route distinguishes 409 from 404.
      updateResult: { data: null, error: null },
    })

    const nextResult = baseResult({ recommendations: [{ id: 'r1' }] })
    const response = await patch(
      patchResult({ analysis_result: nextResult, expected_revision_number: 1 }),
      'a-1',
    )
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/updated elsewhere/i)
  })

  it('does not include any cryptographic authenticity claim in the response (replay checksum, not signature)', async () => {
    const storedManifest = buildStoredManifest()
    const currentResult = baseResult({ scoringInputManifest: storedManifest })
    configureSupabase({
      row: { analysis_result: currentResult, revision_number: 1 },
      updateResult: { data: { id: 'a-1', revision_number: 2 }, error: null },
    })

    const nextResult = baseResult({ recommendations: [{ id: 'r1' }] })
    const response = await patch(
      patchResult({ analysis_result: nextResult, expected_revision_number: 1 }),
      'a-1',
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toMatch(/signature|signed|authentic|authenticate/i)
  })
})
