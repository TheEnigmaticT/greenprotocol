import { describe, expect, it } from 'vitest'
import { applyRecommendationApproval, reconcilePersistedRevision, type AnalysisData } from '@/app/analyze/[id]/page'
import type { RecommendationApprovalReceipt } from '@/components/TalkAboutThis'

const data: AnalysisData = {
  id: 'analysis-1',
  protocolText: 'Original protocol',
  analysis: {
    protocolTitle: 'Amide coupling',
    chemistrySubdomain: 'Organic synthesis',
    steps: [],
    recommendations: [{
      id: 'rec-1',
      stepNumber: 1,
      principleNumbers: [5],
      principleNames: ['Safer Solvents'],
      severity: 'high',
      original: { chemical: 'DMF', issue: 'Hazard' },
      alternative: { chemical: 'EtOAc', rationale: 'Alternative', yieldImpact: 'Validate', caveats: 'Check', evidenceBasis: 'Literature' },
      confidenceLevel: 'medium',
    }],
    revisedProtocol: 'Revised protocol',
    overallAssessment: { greenPrinciplesViolated: [5], mostImpactfulChange: 'Replace DMF', experimentalValidationNeeded: true, disclaimer: 'Validate' },
  },
  impactDelta: {} as AnalysisData['impactDelta'],
  equivalencies: [],
  revisionNumber: 4,
}

const receipt: RecommendationApprovalReceipt = {
  actionId: 'action-1',
  recommendationId: 'rec-1',
  label: 'Use ethyl acetate',
  alreadyAccepted: false,
  revisionNumber: 6,
}

describe('analysis persistence reconciliation', () => {
  it('keeps a newer approved analysis when a delayed PATCH completion arrives below its revision', async () => {
    let resolvePatch: (revision: number) => void = () => undefined
    const delayedPatch = new Promise<number>(resolve => { resolvePatch = resolve })
    let current = data

    current = applyRecommendationApproval(current, receipt)!
    expect(current.analysis.recommendations[0].isAccepted).toBe(true)
    expect(current.revisionNumber).toBe(6)

    resolvePatch(5)
    current = reconcilePersistedRevision(current, await delayedPatch)!

    expect(current.revisionNumber).toBe(6)
    expect(current.analysis.recommendations[0].isAccepted).toBe(true)
  })
})
