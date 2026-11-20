import type { AnalysisResult, Recommendation } from '@/lib/types'
import { sourceProvenanceHash, type SciSureSource } from '@/lib/integrations/scisure'
import type { SciSureWorkspace } from '@/lib/integrations/scisure/workspace-contract'

// Synthetic data, never a live scientific result: three warnings and one hypothesis.
export function recommendation(patch: Partial<Recommendation> = {}): Recommendation {
  return { stepNumber: 1, principleNumbers: [5], principleNames: ['Safer solvents'], severity: 'high', original: { chemical: 'Acetone', issue: 'Hazard' }, alternative: { chemical: 'Water', rationale: 'Fixture rationale', yieldImpact: 'Unknown', caveats: 'Validate experimentally', evidenceBasis: 'Fixture only' }, confidenceLevel: 'low', cardKind: 'warning', ...patch }
}
export function analysis(): AnalysisResult {
  return { protocolTitle: 'Fixture', chemistrySubdomain: 'Fixture', steps: [], recommendations: [recommendation(), recommendation(), recommendation(), recommendation({ id: 'hypothesis', cardKind: 'swap', evidenceAssessment: { disposition: 'analogous_only', directness: 'indirect', supportingReferenceCount: 0, applicability: 'weak', eligibleForApplication: false, eligibilityReason: 'Not established' } })], revisedProtocol: 'UNTRUSTED assembled rewrite', overallAssessment: { greenPrinciplesViolated: [5], mostImpactfulChange: 'Unknown', experimentalValidationNeeded: true, disclaimer: 'Fixture only' } }
}
export function source(): SciSureSource {
  return { version: 1, kind: 'protocol', externalId: 'protocol-1', externalVersionId: 'revision-3', title: 'Original fixture', retrievedAt: '2026-10-01T00:00:00Z', selection: [{ stepId: 'step-1', order: 1, title: 'Mix', originalContent: '<p>Add Acetone. Keep 5 mL and 20 °C.</p>', normalizedText: 'Add Acetone. Keep 5 mL and 20 °C.' }], protocolText: '## Mix\nAdd Acetone. Keep 5 mL and 20 °C.', importWarnings: ['HTML converted to text'] }
}
export function workspace(): SciSureWorkspace {
  return { version: 2, bridgeSessionId: '00000000-0000-0000-0000-000000000001', snapshotId: '00000000-0000-0000-0000-000000000002', sourceHash: sourceProvenanceHash(source()), runId: '00000000-0000-0000-0000-000000000003', principalKind: 'registered', analysisId: '00000000-0000-0000-0000-000000000004', analysisRevision: 1, source: source(), analysis: analysis(), findings: [], status: 'completed', retentionExpiresAt: '2026-12-30T00:00:00Z' }
}
