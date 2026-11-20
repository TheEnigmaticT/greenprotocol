import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Recommendation } from '@/lib/types'
import { analysis, recommendation, workspace } from './scisure-workspace-fixture'
async function module() {
  expect(existsSync(resolve('lib/integrations/scisure/workspace.ts')), 'private workspace implementation exists').toBe(true)
  return import('@/lib/integrations/scisure/workspace')
}
describe('private SciSure workspace (synthetic fixtures)', () => {
  it('shows all four findings with stable zero-based fallback IDs, independent of applicability', async () => {
    const { workspaceFindings } = await module()
    const findings = workspaceFindings(analysis(), {})
    expect(findings.map(f => f.findingId)).toEqual(['finding-0', 'finding-1', 'finding-2', 'hypothesis'])
    expect(findings.map(f => f.recommendationIndex)).toEqual([0, 1, 2, 3])
    expect(findings.every(f => !f.applicable && f.decision === null)).toBe(true)
  })
  it('requires all durable reviews and rejects stale source/revision and noncompleted jobs', async () => {
    const { prepareWorkspaceDraft, workspaceFindings } = await module()
    const w = workspace(); w.findings = workspaceFindings(w.analysis!, {})
    expect(() => prepareWorkspaceDraft(w, { sourceHash: w.sourceHash, analysisRevision: 1 })).toThrow(/review/i)
    w.findings = workspaceFindings(w.analysis!, Object.fromEntries(w.findings.map(f => [f.findingId, 'accepted'])))
    expect(() => prepareWorkspaceDraft(w, { sourceHash: 'b'.repeat(64), analysisRevision: 1 })).toThrow(/revision|source/i)
    expect(() => prepareWorkspaceDraft(w, { sourceHash: w.sourceHash, analysisRevision: 0 })).toThrow(/revision/i)
    expect(() => prepareWorkspaceDraft({ ...w, status: 'running' }, { sourceHash: w.sourceHash, analysisRevision: 1 })).toThrow(/completed/i)
  })
  it('acknowledges warnings/hypotheses without rewriting source or trusting model assembled text', async () => {
    const { prepareWorkspaceDraft, workspaceFindings } = await module()
    const w = workspace(); w.findings = workspaceFindings(w.analysis!, { 'finding-0': 'accepted', 'finding-1': 'accepted', 'finding-2': 'rejected', hypothesis: 'accepted' })
    const bundle = prepareWorkspaceDraft(w, { sourceHash: w.sourceHash, analysisRevision: 1 })
    expect(bundle.draftText).toBe(w.source.protocolText)
    expect(bundle.source).toEqual(w.source)
    expect(bundle.appliedFindingIds).toEqual([])
    expect(bundle.acknowledgedFindingIds).toEqual(['finding-0', 'finding-1', 'hypothesis'])
    expect(bundle.evidenceAppendixText).toContain('acknowledged, not applied')
    expect(bundle.evidenceAppendixText).toContain('rejected')
    expect(bundle.evidenceAppendixText).toContain(w.sourceHash)
    expect(bundle.evidenceAppendixText).toContain(w.runId)
    expect(bundle.privateAnalysisPath).toBe(`/analyze/${w.analysisId}`)
    expect(bundle.privateEvidencePath).toBe(`/analyze/${w.analysisId}/evidence`)
    expect(bundle.evidenceAppendixText).toContain(`/analyze/${w.analysisId}/evidence`)
    expect(bundle.bundleHash).toMatch(/^[a-f0-9]{64}$/)
    expect(prepareWorkspaceDraft({ ...w, principalKind: 'guest', analysisId: undefined }, { sourceHash: w.sourceHash, analysisRevision: 1 }).privateAnalysisPath).toBeUndefined()
  })
  it('applies only a safely mapped eligible substitution and preserves untouched selections and source HTML', async () => {
    const { prepareWorkspaceDraft, workspaceFindings } = await module()
    const w = workspace()
    w.analysis!.recommendations = [recommendation({ id: 'safe', cardKind: 'swap', evidenceAssessment: { disposition: 'supported_applicable', directness: 'direct', supportingReferenceCount: 1, applicability: 'strong', eligibleForApplication: true, eligibilityReason: 'Fixture only' } })]
    w.analysis!.steps = [{ stepNumber: 1, description: w.source.selection[0].normalizedText, chemicals: [], conditions: { temperature: null, duration: null, atmosphere: null } }]
    w.source.selection.push({ sectionId: 'section-2', order: 2, title: 'Unchanged', originalContent: 'Leave Acetone here.', normalizedText: 'Leave Acetone here.' }); w.source.protocolText += '\n\n## Unchanged\nLeave Acetone here.'
    w.findings = workspaceFindings(w.analysis!, { safe: 'accepted' })
    const bundle = prepareWorkspaceDraft(w, { sourceHash: w.sourceHash, analysisRevision: 1 })
    expect(bundle.draftText).toBe('## Mix\nAdd Water. Keep 5 mL and 20 °C.\n\n## Unchanged\nLeave Acetone here.')
    expect(bundle.source.selection[0].originalContent).toContain('<p>Add Acetone.')
    expect(bundle.appliedFindingIds).toEqual(['safe'])
    w.analysis!.recommendations[0].stepNumber = 99
    w.findings = workspaceFindings(w.analysis!, { safe: 'accepted' })
    const unmapped = prepareWorkspaceDraft(w, { sourceHash: w.sourceHash, analysisRevision: 1 })
    expect(unmapped.draftText).toBe(w.source.protocolText)
    expect(unmapped.limitations.join(' ')).toMatch(/map/i)
    expect(unmapped.appliedFindingIds).toEqual([])
  })
  it('names an acknowledged finding by step and chemical in the limitations, never by its raw id', async () => {
    const { prepareWorkspaceDraft, workspaceFindings } = await module()
    const w = workspace()
    const ids = workspaceFindings(w.analysis!, {}).map(f => f.findingId)
    w.findings = workspaceFindings(w.analysis!, Object.fromEntries(ids.map(id => [id, 'accepted' as const])))
    const bundle = prepareWorkspaceDraft(w, { sourceHash: w.sourceHash, analysisRevision: 1 })
    expect(bundle.limitations.some(line => /^Step 1, Acetone: accepted as acknowledgement only/.test(line))).toBe(true)
    expect(bundle.limitations.join('\n')).not.toMatch(/finding-\d/)
  })
  it('does not confuse parsed ordinal numbers with original source step identity', async () => {
    const { prepareWorkspaceDraft, workspaceFindings } = await module()
    const w = workspace()
    w.analysis!.recommendations = [recommendation({ id: 'ordinal-only', cardKind: 'swap', evidenceAssessment: { disposition: 'supported_applicable', directness: 'direct', supportingReferenceCount: 1, applicability: 'strong', eligibleForApplication: true, eligibilityReason: 'Synthetic fixture' } })]
    w.analysis!.steps = [{ stepNumber: 1, description: 'Another step also using Acetone.', chemicals: [], conditions: { temperature: null, duration: null, atmosphere: null } }]
    w.findings = workspaceFindings(w.analysis!, { 'ordinal-only': 'accepted' })
    const bundle = prepareWorkspaceDraft(w, { sourceHash: w.sourceHash, analysisRevision: 1 })
    expect(bundle.appliedFindingIds).toEqual([])
    expect(bundle.draftText).toBe(w.source.protocolText)
    expect(bundle.limitations.join(' ')).toMatch(/map/i)
  })
  it('maps a parsed step by exact source text even when experiment section order is zero', async () => {
    const { prepareWorkspaceDraft, workspaceFindings } = await module()
    const w = workspace()
    w.source.kind = 'experiment'; w.source.selection[0].sectionId = 'section-1'; delete w.source.selection[0].stepId
    w.source.selection[0].order = 0
    w.analysis!.recommendations = [recommendation({ id: 'text-bound', stepNumber: 9, cardKind: 'swap', evidenceAssessment: { disposition: 'supported_applicable', directness: 'direct', supportingReferenceCount: 1, applicability: 'strong', eligibleForApplication: true, eligibilityReason: 'Explicit synthetic fixture' } })]
    w.analysis!.steps = [{ stepNumber: 9, description: w.source.selection[0].normalizedText, chemicals: [], conditions: { temperature: null, duration: null, atmosphere: null } }]
    w.findings = workspaceFindings(w.analysis!, { 'text-bound': 'accepted' })
    const bundle = prepareWorkspaceDraft(w, { sourceHash: w.sourceHash, analysisRevision: 1 })
    expect(bundle.appliedFindingIds).toEqual(['text-bound'])
    expect(bundle.draftText).toBe('## Mix\nAdd Water. Keep 5 mL and 20 °C.')
  })
  it('does not apply absent evidence, warning, ACS nonmutating or noneligible cards', async () => {
    const { workspaceFindings } = await module()
    const a = analysis(); a.recommendations = [recommendation({ cardKind: 'swap' }), ...a.recommendations]
    expect(workspaceFindings(a, {}).every(f => !f.applicable)).toBe(true)
  })
  it('rejects ambiguous IDs instead of misbinding durable decisions', async () => {
    const { workspaceFindings } = await module()
    const a = analysis(); a.recommendations[3].id = 'finding-0'
    expect(() => workspaceFindings(a, {})).toThrow(/ambiguous/i)
  })
  it('rejects malformed model identities and findings rather than fabricating missing science', async () => {
    const { workspaceFindings } = await module()
    const a = analysis()
    a.recommendations[0] = { ...a.recommendations[0], id: 123 as unknown as string }
    expect(() => workspaceFindings(a, {})).toThrow(/Malformed/i)
    a.recommendations[0] = {} as Recommendation
    expect(() => workspaceFindings(a, {})).toThrow(/Malformed/i)
  })
  it('keeps evidence private and does not copy provider signed/public URLs into the appendix', async () => {
    const { prepareWorkspaceDraft, workspaceFindings } = await module()
    const w = workspace()
    w.analysis!.recommendations[0].evidence = { why_flagged: [], why_replacement: [], citations: [{ source_id: 'fixture', source_name: 'Fixture paper', citation: 'https://untrusted.test/share?token=fixture-secret', doi: '10.1000/fixture', url: 'https://untrusted.test/share?token=fixture-secret' }] }
    w.findings = workspaceFindings(w.analysis!, { 'finding-0': 'accepted', 'finding-1': 'rejected', 'finding-2': 'rejected', hypothesis: 'rejected' })
    const b = prepareWorkspaceDraft(w, { sourceHash: w.sourceHash, analysisRevision: 1 })
    expect(b.evidenceAppendixText).toContain('10.1000/fixture')
    expect(b.evidenceAppendixText).not.toContain('fixture-secret')
    expect(b.evidenceAppendixText).not.toContain('https://')
  })
  it('rejects oversized UTF-8 bundles without truncating scientific/source data', async () => {
    const { prepareWorkspaceDraft, workspaceFindings } = await module()
    const w = workspace(); w.findings = workspaceFindings(w.analysis!, { 'finding-0': 'rejected', 'finding-1': 'rejected', 'finding-2': 'rejected', hypothesis: 'rejected' }); w.source.selection[0].originalContent = '🧪'.repeat(70000)
    expect(() => prepareWorkspaceDraft(w, { sourceHash: w.sourceHash, analysisRevision: 1 })).toThrow(/256 KiB/i)
  })
  it('never reports JS replacement metacharacters as applied scientific chemistry', async () => {
    const { prepareWorkspaceDraft, workspaceFindings } = await module()
    const w = workspace()
    w.analysis!.recommendations = [recommendation({ id: 'unsafe-replacement', cardKind: 'swap', alternative: { ...recommendation().alternative, chemical: '$&' }, evidenceAssessment: { disposition: 'supported_applicable', directness: 'direct', supportingReferenceCount: 1, applicability: 'strong', eligibleForApplication: true, eligibilityReason: 'Synthetic fixture' } })]
    w.findings = workspaceFindings(w.analysis!, { 'unsafe-replacement': 'accepted' })
    const bundle = prepareWorkspaceDraft(w, { sourceHash: w.sourceHash, analysisRevision: 1 })
    expect(bundle.appliedFindingIds).toEqual([])
    expect(bundle.draftText).toBe(w.source.protocolText)
    expect(bundle.acknowledgedFindingIds).toEqual(['unsafe-replacement'])
  })
})
