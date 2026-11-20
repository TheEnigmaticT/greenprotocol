import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getScoringViewStatus } from '@/lib/scoring-view-status'
import ScoringAuditNotice from '@/components/ScoringAuditNotice'

function fixture() {
  const scores = { total_score: 7, grade: 'B', scores: [], waste_analysis: undefined }
  const steps = [{ stepNumber: 1, chemicals: [], description: 'Stir water.' }]
  return { steps, deterministicScores: scores, scoringInputManifest: { scores: structuredClone(scores), request: { steps: structuredClone(steps), chemicals: [] } } }
}

describe('original score record versus editable view', () => {
  it('compares JSON values rather than property insertion order', () => {
    const value = fixture()
    value.deterministicScores = { scores: [], grade: 'B', total_score: 7, waste_analysis: undefined }
    expect(getScoringViewStatus(value).kind).toBe('matches-original')
  })
  it('makes a later score edit explicit without rewriting the original record', () => {
    const value = fixture()
    value.deterministicScores.total_score = 99
    expect(getScoringViewStatus(value)).toMatchObject({ kind: 'differs-from-original', scoresMatchOriginal: false })
    expect(value.scoringInputManifest.scores.total_score).toBe(7)
    const html = renderToStaticMarkup(createElement(ScoringAuditNotice, { analysis: value }))
    expect(html).toMatch(/not verified by.*original/i)
    expect(html).toMatch(/replay.*original scores/i)
  })
  it('does not certify changed procedure inputs merely because scores are unchanged', () => {
    const value = fixture()
    value.steps[0].description = 'Different procedure.'
    expect(getScoringViewStatus(value)).toMatchObject({ kind: 'differs-from-original', inputsMatchOriginal: false })
  })
  it('marks legacy results without a record honestly', () => {
    expect(getScoringViewStatus({ steps: [] }).kind).toBe('no-original-record')
  })
})
