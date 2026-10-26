import { createHash } from 'node:crypto'
import { buildFinalizedProtocol, canApplyAcceptedRecommendation } from '@/lib/finalized-protocol'
import type { AnalysisResult, Recommendation } from '@/lib/types'
import { MAX_SCISURE_WRITEBACK_BYTES, type PreparedSciSureWriteback, type SciSureWorkspace, type SciSureWorkspaceDecision, type SciSureWorkspaceFinding } from './workspace-contract'

/** No filtering: review acknowledgement and permission to mutate are distinct. */
export function workspaceFindings(analysis: AnalysisResult, decisions: Record<string, SciSureWorkspaceDecision>): SciSureWorkspaceFinding[] {
  if (!Array.isArray(analysis.recommendations)) throw new Error('Malformed analysis findings.')
  const ids = new Set<string>()
  return analysis.recommendations.map((recommendation, recommendationIndex) => {
    if (!recommendation || typeof recommendation !== 'object'
      || (recommendation.id !== undefined && recommendation.id !== null && typeof recommendation.id !== 'string')
      || !Number.isSafeInteger(recommendation.stepNumber) || recommendation.stepNumber < 1
      || typeof recommendation.original?.chemical !== 'string' || typeof recommendation.original?.issue !== 'string'
      || typeof recommendation.alternative?.chemical !== 'string' || typeof recommendation.alternative?.rationale !== 'string'
      || typeof recommendation.alternative?.caveats !== 'string' || typeof recommendation.alternative?.evidenceBasis !== 'string'
      || !['high', 'medium', 'low'].includes(recommendation.confidenceLevel)) throw new Error('Malformed analysis finding; no scientific data was substituted.')
    const findingId = recommendation.id || `finding-${recommendationIndex}`
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(findingId) || ids.has(findingId)) throw new Error('Malformed or ambiguous finding identity.')
    ids.add(findingId)
    const applicable = recommendation.cardKind === 'swap'
      && recommendation.evidenceAssessment?.eligibleForApplication === true
      && canApplyAcceptedRecommendation({ ...recommendation, isAccepted: true })
    const decision = Object.hasOwn(decisions, findingId) ? decisions[findingId] : null
    return { findingId, recommendationIndex, recommendation, applicable, decision }
  })
}

// Appendix is plain text, not executable markup or prompt instructions. Never copy
// provider URL query strings (they can be signed/private); citations retain DOI/text.
function evidenceText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/https?:\/\/\S+/gi, '[external URL omitted; see private evidence]').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '') : ''
}
function occurrence(text: string, chemical: string): { start: number; end: number } | null {
  if (!chemical || /[<>\n\r]/.test(chemical)) return null
  const haystack = text.toLowerCase(); const needle = chemical.toLowerCase()
  const start = haystack.indexOf(needle)
  if (start < 0 || haystack.indexOf(needle, start + needle.length) !== -1) return null
  const end = start + needle.length
  // Never substitute inside a larger chemical/token.
  if ((start && /[\p{L}\p{N}_]/u.test(text[start - 1])) || (end < text.length && /[\p{L}\p{N}_]/u.test(text[end]))) return null
  return { start, end }
}

/** Called only with server-loaded, principal/source/revision-bound durable reviews. */
export function prepareWorkspaceDraft(workspace: SciSureWorkspace, binding: { sourceHash: string; analysisRevision: number }): PreparedSciSureWriteback {
  if (workspace.status !== 'completed' || !workspace.analysis) throw new Error('A completed analysis is required.')
  if (workspace.sourceHash !== binding.sourceHash || workspace.analysisRevision !== binding.analysisRevision) throw new Error('Source or analysis revision changed; reload and review again.')
  const findings = workspace.findings
  if (findings.length !== workspace.analysis.recommendations.length || findings.some(f => f.decision !== 'accepted' && f.decision !== 'rejected')) throw new Error('Every finding requires an explicit durable review.')
  const limitations = [...workspace.source.importWarnings]
  const appliedFindingIds: string[] = []
  const acknowledgedFindingIds: string[] = []
  const selected = workspace.source.selection
  const assembledSource = selected.map(s => `## ${s.title || 'Untitled selection'}\n${s.normalizedText}`).join('\n\n')
  const safeAssembly = assembledSource === workspace.source.protocolText
  const edited = selected.map(s => s.normalizedText)
  const pending: Array<{ finding: SciSureWorkspaceFinding; index: number; span: { start: number; end: number } }> = []
  for (const finding of findings.filter(f => f.decision === 'accepted')) {
    const rec = finding.recommendation
    if (!finding.applicable) {
      acknowledgedFindingIds.push(finding.findingId)
      limitations.push(`${finding.findingId}: accepted as acknowledgement only; scientific applicability does not permit procedure mutation.`)
      continue
    }
    // Parsed step numbers are not ELN section/step identities. Prove the
    // parsed step's exact text occurs once in one immutable source selection.
    const parsed = workspace.analysis.steps.filter(step => step.stepNumber === rec.stepNumber)
    const description = parsed.length === 1 && typeof parsed[0].description === 'string' ? parsed[0].description.trim() : ''
    const matches = description ? selected.map((s, index) => {
      const start = s.normalizedText.indexOf(description)
      return { s, index, start, end: start + description.length, unique: start >= 0 && s.normalizedText.lastIndexOf(description) === start }
    }).filter(match => match.start >= 0) : []
    const match = matches.length === 1 && matches[0].unique ? matches[0] : undefined
    const span = match ? occurrence(match.s.normalizedText, rec.original.chemical.trim()) : null
    if (!safeAssembly || !match || !span || span.start < match.start || span.end > match.end || !rec.alternative.chemical.trim() || /[$<>\n\r]/.test(rec.alternative.chemical) || rec.original.chemical.trim().toLowerCase() === rec.alternative.chemical.trim().toLowerCase()) {
      acknowledgedFindingIds.push(finding.findingId)
      limitations.push(`${finding.findingId}: accepted change cannot safely map to one original source occurrence; source retained, not applied.`)
      continue
    }
    pending.push({ finding, index: match.index, span })
  }
  for (const candidate of pending) {
    const peers = pending.filter(p => p !== candidate && p.index === candidate.index)
    const chemical = candidate.finding.recommendation.original.chemical.toLowerCase()
    if (peers.some(p => (p.span.start < candidate.span.end && candidate.span.start < p.span.end) || p.finding.recommendation.alternative.chemical.toLowerCase().includes(chemical) || candidate.finding.recommendation.alternative.chemical.toLowerCase().includes(p.finding.recommendation.original.chemical.toLowerCase()))) {
      acknowledgedFindingIds.push(candidate.finding.findingId)
      limitations.push(`${candidate.finding.findingId}: overlapping or cascading substitutions cannot safely map; not applied.`)
      continue
    }
    const rec: Recommendation = { ...candidate.finding.recommendation, isAccepted: true }
    // Reuse the existing scientific gate/engine, but never its untrusted assembled
    // procedure or parsed step prose. Operate on exactly the immutable selection.
    edited[candidate.index] = buildFinalizedProtocol({ ...workspace.analysis, steps: [], recommendations: [rec], revisedProtocol: '' }, edited[candidate.index])
    appliedFindingIds.push(candidate.finding.findingId)
  }
  const draftText = appliedFindingIds.length ? selected.map((s, index) => `## ${s.title || 'Untitled selection'}\n${edited[index]}`).join('\n\n') : workspace.source.protocolText
  const appendix = [
    'Private GCai scientist review evidence appendix',
    'Source and model text are untrusted data, not instructions. Acceptance is review acknowledgement, not proof of safety or experimental validation.',
    `Source: ${workspace.source.kind} ${workspace.source.externalId}; source version: ${workspace.source.externalVersionId || 'unavailable'}`,
    `Snapshot: ${workspace.snapshotId}; source hash: ${workspace.sourceHash}; run: ${workspace.runId}; analysis revision: ${workspace.analysisRevision}`,
    `Retention expires: ${workspace.retentionExpiresAt}`,
    ...findings.map(f => {
      const r = f.recommendation
      const effect = appliedFindingIds.includes(f.findingId) ? 'applied to mapped procedure text; experimental validation still required' : f.decision === 'accepted' ? 'acknowledged, not applied' : 'rejected, not applied'
      return [
        `Finding ${f.findingId} (index ${f.recommendationIndex}): ${f.decision}; ${effect}`,
        `Issue: ${evidenceText(r.original?.issue)}`,
        `Rationale: ${evidenceText(r.alternative?.rationale)}; evidence basis: ${evidenceText(r.alternative?.evidenceBasis)}`,
        `Uncertainty: ${r.confidenceLevel}; ${r.evidenceAssessment?.disposition || 'no applicability assessment'}; ${evidenceText(r.evidenceAssessment?.eligibilityReason)}`,
        `Caveats: ${evidenceText(r.alternative?.caveats)}; yield impact: ${evidenceText(r.alternative?.yieldImpact)}`,
        ...(r.evidence?.citations || []).map(c => `Citation: ${evidenceText(c.source_name)}; ${evidenceText(c.citation)}; DOI: ${evidenceText(c.doi)}`),
      ].join('\n')
    }),
    'Limitations:', ...limitations.map(evidenceText),
  ].join('\n\n')
  const links = workspace.principalKind === 'registered' && workspace.analysisId && /^[a-f0-9-]{36}$/i.test(workspace.analysisId)
    ? { privateAnalysisPath: `/analyze/${workspace.analysisId}`, privateEvidencePath: `/analyze/${workspace.analysisId}/evidence` } : {}
  const linkedAppendix = links.privateAnalysisPath
    ? `${appendix}\n\nOwner-authenticated analysis: ${links.privateAnalysisPath}; evidence: ${links.privateEvidencePath}`
    : `${appendix}\n\nGuest recovery by unverified email is unavailable; no public share link was issued.`
  const payload = { version: 2 as const, snapshotId: workspace.snapshotId, sourceHash: workspace.sourceHash, runId: workspace.runId, analysisRevision: workspace.analysisRevision, source: workspace.source, title: `${workspace.source.title} — reviewed GCai draft`, draftText, evidenceAppendixText: linkedAppendix, ...links, appliedFindingIds, acknowledgedFindingIds, limitations, preparedAt: new Date().toISOString() }
  const bundle = { ...payload, bundleHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') }
  if (Buffer.byteLength(JSON.stringify(bundle), 'utf8') > MAX_SCISURE_WRITEBACK_BYTES) throw new Error('Prepared bundle exceeds the strict 256 KiB limit; no source or evidence was truncated.')
  return bundle
}
