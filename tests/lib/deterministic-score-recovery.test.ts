import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import DeterministicScoreRecovery from '@/components/DeterministicScoreRecovery'
import { applyDeterministicScores, rescoreAnalysis } from '@/lib/rescore'
import { buildChemistryStatusMessage } from '@/lib/chemistry-status-message'
import { humanizeError, toHumanError } from '@/lib/errors/humanize'
import type { AnalysisResult, DeterministicScores } from '@/lib/types'

const analysis = {
  protocolTitle: 'Test protocol',
  chemistryDataStatus: {
    pending: true,
    deterministicScoringAvailable: false,
    unresolvedChemicals: ['unknown reagent'],
    message: 'old wording',
  },
} as AnalysisResult
const scores = { grade: 'B', total_score: 12, max_possible: 120, scores: [] } as unknown as DeterministicScores

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function rescoreFailure() {
  try {
    await rescoreAnalysis(analysis)
  } catch (error) {
    return toHumanError(error)
  }
  throw new Error('rescoreAnalysis should have failed')
}

describe('missing deterministic score recovery', () => {
  it('renders an honest unavailable panel with an authenticated retry action', () => {
    const markup = renderToStaticMarkup(createElement(DeterministicScoreRecovery, {
      onRetry: () => undefined,
      isRetrying: false,
      error: null,
    }))

    expect(markup).toContain('Grade unavailable')
    expect(markup).toContain('Retry scoring')
    expect(markup).toContain('type="button"')
    expect(markup).not.toContain('Deterministic')
  })

  it('offers a chat about the missing grade only when the analysis is saved', () => {
    const props = { onRetry: () => undefined, isRetrying: false, error: null }

    expect(renderToStaticMarkup(createElement(DeterministicScoreRecovery, props))).not.toContain('Chat about this')
    expect(renderToStaticMarkup(createElement(DeterministicScoreRecovery, { ...props, analysisId: 'analysis-1' }))).toContain('Chat about this')
  })

  it('rescores through the existing API and merges returned scores into the analysis', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => scores })
    vi.stubGlobal('fetch', fetchMock)

    const returnedScores = await rescoreAnalysis(analysis)
    const updated = applyDeterministicScores(analysis, returnedScores)

    expect(fetchMock).toHaveBeenCalledWith('/api/rescore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis }),
    })
    expect(updated.deterministicScores).toBe(scores)
    expect(updated.chemistryDataStatus).toEqual({
      pending: true,
      deterministicScoringAvailable: true,
      unresolvedChemicals: ['unknown reagent'],
      message: buildChemistryStatusMessage({ scoringAvailable: true, unresolvedCount: 1, indefiniteCount: 0 }),
    })
    vi.unstubAllGlobals()
  })

  it('keeps the per-material details through a successful rescore', () => {
    const detailed = {
      ...analysis,
      chemistryDataStatus: {
        ...analysis.chemistryDataStatus!,
        unresolvedDetails: [{ name: 'unknown reagent', reason: 'not_recognized' as const, stepNumber: 2 }],
      },
    }

    expect(applyDeterministicScores(detailed, scores).chemistryDataStatus?.unresolvedDetails).toEqual(detailed.chemistryDataStatus.unresolvedDetails)
  })

  it('says the reference data is unreachable when the chemistry service is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(503, { code: 'chemistry_service_unavailable', error: 'x' })))

    const error = await rescoreFailure()

    expect(error).toEqual(humanizeError({ code: 'chemistry_service_unavailable' }))
    expect(error.message).toMatch(/unreachable/i)
    vi.unstubAllGlobals()
  })

  it('says the saved analysis is unusable on a 400, not that the service is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(400, { code: 'invalid_analysis', error: 'x' })))
    expect((await rescoreFailure()).code).toBe('invalid_analysis')
    vi.unstubAllGlobals()
  })

  it('says scoring did not finish on a 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(500, { code: 'scoring_failed', error: 'x' })))
    expect((await rescoreFailure()).code).toBe('scoring_failed')
    vi.unstubAllGlobals()
  })

  it('still classifies by status when a gateway replies without a code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Service Unavailable</html>', { status: 503 })))
    expect((await rescoreFailure()).code).toBe('chemistry_service_unavailable')
    vi.unstubAllGlobals()
  })

  it('treats a dropped connection as the reference data being unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const error = await rescoreFailure()
    expect(error.code).toBe('chemistry_service_unavailable')
    expect(error.message).not.toContain('fetch failed')
    vi.unstubAllGlobals()
  })

  it('renders the cause of a failed retry as an alert', () => {
    const markup = renderToStaticMarkup(createElement(DeterministicScoreRecovery, {
      onRetry: () => undefined,
      isRetrying: false,
      error: humanizeError({ code: 'chemistry_service_unavailable' }),
    }))

    expect(markup).toContain("We can&#x27;t reach our chemical reference data")
    expect(markup).toContain('retry scoring in a few minutes')
    expect(markup).toContain('role="alert"')
  })
})
