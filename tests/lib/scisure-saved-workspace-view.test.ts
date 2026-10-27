import { describe, expect, it } from 'vitest'
import type { SciSureWorkspaceFinding } from '@/lib/integrations/scisure/workspace-contract'
import {
  classifyWorkspaceResponse, decisionLabel, distinctRationale, findingEffectNote, findingKindLabel, replacementChemical, retentionLabel, reviewProgress,
} from '@/lib/integrations/scisure/saved-workspace-view'

const finding = (over: Partial<SciSureWorkspaceFinding> & { cardKind?: 'swap' | 'warning' } = {}): SciSureWorkspaceFinding => ({
  findingId: 'f', recommendationIndex: 0, applicable: false, decision: null,
  recommendation: { stepNumber: 1, cardKind: over.cardKind ?? 'swap' } as SciSureWorkspaceFinding['recommendation'],
  ...over,
})
const response = (status: number, body?: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
const ready = { version: 2, analysis: { recommendations: [] }, findings: [], retentionExpiresAt: '2099-01-01T00:00:00Z' }

describe('saved SciSure workspace view model', () => {
  it('keeps sign-in, unavailable and transient failure distinct', async () => {
    expect(await classifyWorkspaceResponse(response(401))).toEqual({ kind: 'signin' })
    expect(await classifyWorkspaceResponse(response(404))).toEqual({ kind: 'unavailable' })
    expect(await classifyWorkspaceResponse(response(500))).toEqual({ kind: 'error' })
  })
  it('rejects a 200 whose body is not a v2 completed workspace instead of rendering it', async () => {
    expect((await classifyWorkspaceResponse(response(200, { ...ready, version: 1 }))).kind).toBe('error')
    expect((await classifyWorkspaceResponse(response(200, { ...ready, analysis: null }))).kind).toBe('error')
    expect((await classifyWorkspaceResponse(response(200, null))).kind).toBe('error')
    expect((await classifyWorkspaceResponse({ status: 200, ok: true, json: async () => { throw new Error('bad json') } })).kind).toBe('error')
    expect((await classifyWorkspaceResponse(response(200, ready))).kind).toBe('ready')
  })
  it('never describes a non-eligible finding as changing the procedure, even when accepted', () => {
    const accepted = finding({ cardKind: 'warning', decision: 'accepted' })
    expect(decisionLabel(accepted)).toBe('Accepted')
    expect(findingKindLabel(accepted)).toBe('Hazard warning')
    expect(findingEffectNote(accepted)).toBe('Acknowledging this finding never changes the procedure.')
    expect(findingKindLabel(finding())).toBe('Hypothesis, not application-eligible')
  })
  it('labels eligible swaps by decision state', () => {
    expect(findingKindLabel(finding({ applicable: true }))).toBe('Substitution')
    expect(findingEffectNote(finding({ applicable: true, decision: 'accepted' }))).toMatch(/Accepted as an application-eligible/)
    expect(findingEffectNote(finding({ applicable: true, decision: 'rejected' }))).toMatch(/stays as written/)
    expect(decisionLabel(finding({ applicable: true }))).toBe('Not reviewed')
  })
  it('counts only decided findings as reviewed', () => {
    expect(reviewProgress([finding({ decision: 'accepted' }), finding({ decision: 'rejected' }), finding()])).toEqual({ reviewed: 2, total: 3 })
  })
  it('renders retention as a UTC date and refuses an unparseable one', () => {
    expect(retentionLabel('2027-01-12T23:59:00Z')).toBe('Retained until 2027-01-12 (UTC)')
    expect(retentionLabel('not a date')).toBe('Retention date unavailable')
  })
  it('shows an arrow only for a real replacement, and a rationale only when it adds a sentence', () => {
    const f = (original: string, alt: string, issue: string, rationale: string) => ({ recommendation: { original: { chemical: original, issue }, alternative: { chemical: alt, rationale } } }) as SciSureWorkspaceFinding
    expect(replacementChemical(f('benzoic acid', 'benzoic acid', 'x', 'x'))).toBeNull()
    expect(replacementChemical(f('DMF', ' dmf ', 'x', 'x'))).toBeNull()
    expect(replacementChemical(f('DMF', '', 'x', 'x'))).toBeNull()
    expect(replacementChemical(f('DMF', 'Cyrene', 'x', 'x'))).toBe('Cyrene')
    expect(distinctRationale(f('a', 'b', 'Hazardous.', 'Hazardous.'))).toBeNull()
    expect(distinctRationale(f('a', 'b', 'Hazardous.', 'Bio-derived.'))).toBe('Bio-derived.')
  })
})
