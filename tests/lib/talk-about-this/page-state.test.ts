import { describe, expect, it } from 'vitest'
import { parseOpenConversationResponse, type RecommendationApprovalReceipt } from '@/components/TalkAboutThis'
import { applyRecommendationApproval, reconcilePersistedRevision, type AnalysisData } from '@/app/analyze/[id]/page'

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

describe('scoped conversation opening state', () => {
  const scope = { kind: 'recommendation', recommendationId: 'rec-1' } as const
  const evidence = {
    id: 'evidence-1',
    sourceDocumentId: 'doi:10.1000/example',
    title: 'Scoped evidence',
    pageStart: 12,
    pageEnd: 12,
    quote: 'Relevant support.',
    similarity: 0.9,
    candidateStatus: 'adjudicated',
  }

  it('validates and hydrates a resumed server payload with persisted transcript state', () => {
    const response = parseOpenConversationResponse(scope, {
      conversationId: 'conversation-1',
      disposition: 'resumed',
      scope,
      contextHash: 'a'.repeat(64),
      noDirectEvidence: false,
      messages: [{
        id: 'message-1',
        role: 'assistant',
        content: 'Persisted answer.',
        citations: ['evidence-1'],
        status: 'complete',
        ttftMs: 123,
        createdAt: '2026-08-12T00:00:00.000Z',
      }],
      evidenceReceipts: [{ evidence, receivedAt: '2026-08-12T00:00:00.000Z' }],
      approvalReceipt: {
        recommendationId: 'rec-1',
        label: 'Use ethyl acetate',
        alreadyAccepted: false,
        actionId: 'approval-1',
        revisionNumber: 7,
        receivedAt: '2026-08-12T00:00:00.000Z',
      },
    })

    expect(response).toMatchObject({
      conversationId: 'conversation-1',
      disposition: 'resumed',
      messages: [{ id: 'message-1', content: 'Persisted answer.' }],
      evidenceReceipts: [{ evidence }],
      approvalReceipt: { actionId: 'approval-1' },
    })
  })

})
