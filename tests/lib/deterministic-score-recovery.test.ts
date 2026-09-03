import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import DeterministicScoreRecovery from '@/components/DeterministicScoreRecovery'
import { applyDeterministicScores, rescoreAnalysis } from '@/lib/rescore'
import type { AnalysisResult, DeterministicScores } from '@/lib/types'

const analysis = {
  protocolTitle: 'Test protocol',
  chemistryDataStatus: {
    pending: true,
    deterministicScoringAvailable: false,
    unresolvedChemicals: ['unknown reagent'],
    message: 'Deterministic chemistry scoring was unavailable.',
  },
} as AnalysisResult
const scores = { grade: 'B', total_score: 12, max_possible: 120, scores: [] } as unknown as DeterministicScores

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
      message: 'We could not retrieve every chemical reference record live. This analysis used the best data available, and queued the missing items so the analysis can be re-run when updated reference data is available.',
    })
    vi.unstubAllGlobals()
  })

  it('surfaces a failed rescore response to the caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    await expect(rescoreAnalysis(analysis)).rejects.toThrow('Unable to re-score this analysis')
    vi.unstubAllGlobals()
  })

  it('renders a user-visible retry error', () => {
    const markup = renderToStaticMarkup(createElement(DeterministicScoreRecovery, {
      onRetry: () => undefined,
      isRetrying: false,
      error: 'Unable to re-score this analysis. Please try again.',
    }))

    expect(markup).toContain('Unable to re-score this analysis. Please try again.')
    expect(markup).toContain('role="alert"')
  })
})
