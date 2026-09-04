import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { applyRecommendationApprovedEvent, ApprovalReceiptCard, ClosedConversationError, DiscussionScopeInstruction, EvidenceReceiptCard, activityForEvent, approvalFromEvent, evidenceFromEvent, focusMessageComposer, groupVerificationNotes, handleComposerKeyDown, isNewConversationCommand, parsePersistedRecommendationApprovalReceipt, parseRecommendationApprovedEvent, verificationNoteFromEvent } from '@/components/TalkAboutThis'
import FinalizedProtocol from '@/components/FinalizedProtocol'
import { EvidenceAtlasTalkControl } from '@/components/AnalysisResults'
import { activityData } from '@/lib/talk-about-this/agent'
import type { TalkAboutScope } from '@/lib/talk-about-this/context'
import { buildTalkAboutSystemPrompt } from '@/lib/talk-about-this/prompt'
import type { TalkAboutContext } from '@/lib/talk-about-this/context'
import type { AnalysisResult } from '@/lib/types'

const context: TalkAboutContext = {
  schemaVersion: 1,
  analysisId: 'analysis-1',
  scope: { kind: 'recommendation', recommendationId: 'rec-1' },
  protocolTitle: 'Solvent comparison',
  protocolText: 'Compare solvents at room temperature.',
  steps: [],
  recommendations: [],
  scores: [],
  citations: [],
  noDirectEvidence: true,
  contextHash: 'a'.repeat(64),
}

describe('activityForEvent', () => {
  it('labels completed screening with sources, measurement status, and validation disclosure', () => {
    expect(activityForEvent('tool-complete', {
      callId: 'screen-1',
      tool: 'screen_solvent_candidates',
      source: 'BigSolDB + PubChem GHS',
      status: 'ok',
      measurementCount: 2,
      datasetSources: ['BigSolDB v2.0', 'PubChem GHS'],
    })).toMatchObject({
      label: 'Received local solvent screening evidence',
      state: 'complete',
      detail: expect.stringContaining('Source: BigSolDB · PubChem GHS'),
    })

    expect(activityForEvent('tool-complete', {
      tool: 'screen_solvent_candidates',
      source: 'BigSolDB + PubChem GHS',
      status: 'ok',
      measurementCount: 2,
      datasetSources: ['BigSolDB v2.0', 'PubChem GHS'],
    })?.detail).toContain('2 measurements')
    expect(activityForEvent('tool-complete', {
      tool: 'screen_solvent_candidates',
      source: 'BigSolDB + PubChem GHS',
      status: 'ok',
    })?.detail).toContain('Laboratory compatibility validation required')
  })

  it.each([
    ['CHEM21', 'lookup_chem21_solvent', 'CHEM21'],
    ['BigSolDB', 'lookup_experimental_solvent_evidence', 'BigSolDB v2.0'],
    ['MixtureSolDB', 'lookup_experimental_solvent_evidence', 'MixtureSolDB'],
    ['density', 'lookup_experimental_solvent_evidence', 'BigSolDB v2.0 densities'],
    ['PubChem GHS', 'lookup_solvent_hazard_profile', 'PubChem'],
  ])('distinguishes the %s source label', (label, tool, source) => {
    const activity = activityForEvent('tool-complete', {
      tool,
      source,
      status: 'ok',
      classification: 'recommended',
      measurementCount: 1,
    })

    expect(activity?.detail).toContain(`Source: ${label}`)
    expect(activity?.detail).toContain('Status: available')
  })

  it('leaves unavailable GHS information unknown rather than safe', () => {
    const activity = activityForEvent('tool-complete', {
      tool: 'lookup_solvent_hazard_profile',
      source: 'PubChem GHS',
      status: 'unavailable',
      warnings: ['No local GHS profile is available.'],
    })

    expect(activity).toMatchObject({ state: 'failed', label: 'PubChem GHS profile unavailable' })
    expect(activity?.detail).toContain('GHS information is unknown, not safe')
  })
})

describe('conversation commands and verification notes', () => {
  it('recognizes only exact trimmed new-conversation commands', () => {
    expect(isNewConversationCommand(' /new ')).toBe(true)
    expect(isNewConversationCommand('/clear')).toBe(true)
    expect(isNewConversationCommand('/clear later')).toBe(false)
    expect(isNewConversationCommand('new')).toBe(false)
  })

  it('uses only safe verification fields and groups repeated notes', () => {
    const note = verificationNoteFromEvent('tool-failed', {
      tool: 'lookup_chem21_solvent',
      status: 'timed_out',
      source: 'CHEM21',
      reasonCode: 'deadline_exceeded',
      userNote: 'Couldn’t verify CHEM21 data before the response deadline.',
      reason: 'raw upstream diagnostic',
      reasonDetail: 'raw connection details',
    })

    expect(note).toEqual({
      source: 'CHEM21',
      reasonCode: 'deadline_exceeded',
      text: 'Couldn’t verify CHEM21 data before the response deadline.',
    })
    expect(JSON.stringify(note)).not.toContain('raw')
    expect(groupVerificationNotes([note!, note!, {
      source: 'PubChem GHS',
      reasonCode: 'source_unavailable',
      text: 'Couldn’t verify the PubChem GHS profile.',
    }])).toEqual([
      {
        source: 'CHEM21',
        reasonCode: 'deadline_exceeded',
        text: 'Couldn’t verify CHEM21 data before the response deadline.',
        count: 2,
      },
      {
        source: 'PubChem GHS',
        reasonCode: 'source_unavailable',
        text: 'Couldn’t verify the PubChem GHS profile.',
        count: 1,
      },
    ])
  })

  it('submits only unmodified Enter from the composer', () => {
    const requestSubmit = vi.fn()
    const preventDefault = vi.fn()
    const event = (key: string, shiftKey: boolean) => ({
      key,
      shiftKey,
      preventDefault,
      currentTarget: { form: { requestSubmit } },
    }) as unknown as Parameters<typeof handleComposerKeyDown>[0]

    handleComposerKeyDown(event('Enter', true), false, 'Question')
    handleComposerKeyDown(event('Enter', false), false, 'Question')

    expect(requestSubmit).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })
})

describe('composer focus after conversation opening', () => {
  it('returns focus to the composer after a successful new chat opening', () => {
    const focus = vi.fn()

    focusMessageComposer({ current: { focus } })

    expect(focus).toHaveBeenCalledTimes(1)
  })
})

describe('structured literature evidence activity', () => {
  const evidence = {
    id: 'evidence-1',
    sourceDocumentId: 'doi:10.1000/example',
    title: 'Solvent substitution study',
    pageStart: 12,
    pageEnd: 13,
    quote: 'Ethyl acetate provided a practical alternative under these conditions.',
    candidateStatus: 'candidate',
    similarity: 0.86,
    applicability: 'Room-temperature substitution',
    limitations: 'Confirm substrate compatibility before adoption.',
  }

  it('labels literature lookups and exposes only valid structured candidate evidence', () => {
    expect(activityForEvent('tool-complete', {
      callId: 'lit-1',
      tool: 'search_scoped_literature_evidence',
      status: 'ok',
      source: 'GC.ai literature evidence units',
    })).toMatchObject({
      label: 'Received scoped literature evidence',
      state: 'complete',
    })

    expect(evidenceFromEvent('tool-complete', { evidence: [evidence] })).toEqual([evidence])
  })

  it('rejects optional fields with invalid types before they can reach React rendering', () => {
    expect(evidenceFromEvent('done', {
      evidence: [
        { ...evidence, applicability: { unsafe: true } },
        { ...evidence, limitations: ['unsafe'] },
      ],
    })).toEqual([])
  })

  it('renders literal candidate-pending-adjudication status as Candidate evidence', () => {
    const candidate = {
      ...evidence,
      candidateStatus: 'candidate_pending_adjudication',
      applicability: undefined,
      limitations: undefined,
    }
    const markup = renderToStaticMarkup(createElement(EvidenceReceiptCard, { evidence: candidate, receivedAt: '2026-08-12T00:00:00.000Z' }))

    expect(markup).toContain('Candidate evidence')
    expect(markup).toContain('Status: candidate_pending_adjudication.')
    expect(markup).not.toContain('Adjudicated evidence')
  })
})

describe('closed conversation-open errors', () => {
  it('renders a failed conversation-open request as an accessible alert while the dialog is closed', () => {
    const closedMarkup = renderToStaticMarkup(createElement(ClosedConversationError, {
      error: 'Chat service is unavailable.',
      isOpen: false,
    }))

    const openMarkup = renderToStaticMarkup(createElement(ClosedConversationError, {
      error: 'Chat service is unavailable.',
      isOpen: true,
    }))

    expect(closedMarkup).toContain('role="alert"')
    expect(closedMarkup).toContain('Chat service is unavailable.')
    expect(openMarkup).toBe('')
  })
})

describe('scope instructions and Evidence Atlas controls', () => {
  it('shows explicit approval guidance only for a stable recommendation scope', () => {
    expect(renderToStaticMarkup(createElement(DiscussionScopeInstruction, { scope: { kind: 'recommendation', recommendationId: 'rec-1' } })))
      .toContain('approve this')
    expect(renderToStaticMarkup(createElement(DiscussionScopeInstruction, { scope: { kind: 'principle', principleNumber: 1 } })))
      .toContain('does not change the analysis')
  })

  it('labels the Atlas control as P1 and derives sourced state from P1 recommendation citations', () => {
    const analysis = {
      recommendations: [
        { principleNumbers: [1], evidence: { citations: [{ source_id: 'atlas-p1', source_name: 'Atlas', citation: 'P1 citation' }] } },
        { principleNumbers: [2], evidence: { citations: [{ source_id: 'atlas-p2', source_name: 'Atlas', citation: 'P2 citation' }] } },
      ],
    } as AnalysisResult
    const markup = renderToStaticMarkup(createElement(EvidenceAtlasTalkControl, { analysisId: 'analysis-1', analysis }))

    expect(markup).toContain('Ask')
    expect(markup).toContain('aria-label="Ask. Direct evidence is included in this discussion."')
    expect(markup).toContain('Direct evidence is included')
  })

  it('does not claim sourced evidence for P1 when only another principle has citations', () => {
    const analysis = {
      recommendations: [
        { principleNumbers: [1], evidence: { citations: [] } },
        { principleNumbers: [2], evidence: { citations: [{ source_id: 'atlas-p2', source_name: 'Atlas', citation: 'P2 citation' }] } },
      ],
    } as AnalysisResult
    const markup = renderToStaticMarkup(createElement(EvidenceAtlasTalkControl, { analysisId: 'analysis-1', analysis }))
    expect(markup).toContain('Model-inferred — no direct evidence located.')
  })
})

describe('accepted recommendation receipt access', () => {
  it('renders an accessible scoped Talk About This control for an accepted stable recommendation', () => {
    const analysis = {
      protocolTitle: 'Solvent comparison',
      chemistrySubdomain: 'Synthetic chemistry',
      steps: [],
      revisedProtocol: 'Use ethyl acetate.',
      overallAssessment: {
        greenPrinciplesViolated: [5],
        mostImpactfulChange: 'Replace DMF.',
        experimentalValidationNeeded: true,
        disclaimer: 'Validate experimentally.',
      },
      recommendations: [{
        id: 'rec-accepted-stable',
        stepNumber: 1,
        principleNumbers: [5],
        principleNames: ['Safer solvents and auxiliaries'],
        severity: 'high',
        original: { chemical: 'DMF', issue: 'Reproductive toxicity concern.' },
        alternative: {
          chemical: 'Ethyl acetate',
          rationale: 'Lower-hazard solvent alternative.',
          yieldImpact: 'Validate experimentally.',
          caveats: 'Confirm solubility.',
          evidenceBasis: 'Literature evidence.',
        },
        evidence: {
          why_flagged: [],
          why_replacement: [],
          citations: [{ source_id: 'evidence-1', source_name: 'Source', citation: 'Citation' }],
        },
        confidenceLevel: 'high',
        evidenceTier: 'sourced',
        isAccepted: true,
      }],
    } as AnalysisResult

    const markup = renderToStaticMarkup(createElement(FinalizedProtocol, { analysis, analysisId: 'analysis-1' }))
    const missingIdMarkup = renderToStaticMarkup(createElement(FinalizedProtocol, {
      analysis: {
        ...analysis,
        recommendations: [{ ...analysis.recommendations[0], id: undefined }],
      },
      analysisId: 'analysis-1',
    }))

    expect(markup).toContain('Accepted · 1')
    expect(markup).toContain('aria-label="Ask. Direct evidence is included in this discussion."')
    expect(missingIdMarkup).not.toContain('aria-label="Ask.')
  })
})

describe('activityData', () => {
  it('flattens screening candidate measurements, citations, and warnings into activity metadata', () => {
    const candidateWarning = 'Laboratory validation required: confirm catalyst effects before any solvent change.'
    const metadata = activityData(
      { id: 'screen-1', name: 'screen_solvent_candidates', arguments: '{}' },
      {
        operation: 'solvent_screening',
        chemical_name: 'DMF',
        status: 'ok',
        source: 'Local solvent evidence catalogue',
        data: {
          candidates: [{
            current_measurements: [{ source: 'BigSolDB v2.0' }],
            candidate_measurements: [{ source: 'BigSolDB v2.0' }],
            citations: [{ source: 'MixtureSolDB' }],
            warnings: [candidateWarning],
          }],
        },
        citations: [{ source_id: 'pubchem:ghs', source_name: 'PubChem GHS', citation: 'PubChem GHS' }],
        warnings: [],
      },
    )

    expect(metadata).toMatchObject({
      measurementCount: 2,
      datasetSources: expect.arrayContaining(['BigSolDB v2.0', 'MixtureSolDB', 'PubChem GHS']),
      warnings: [candidateWarning],
    })
  })
})

describe('screening prompt copy', () => {
  it('requires laboratory compatibility validation before treating screening as a recommendation', () => {
    expect(buildTalkAboutSystemPrompt(context)).toContain('laboratory compatibility validation')
  })
})

describe('parseRecommendationApprovedEvent', () => {
  const scope: TalkAboutScope = { kind: 'recommendation', recommendationId: 'rec-1' }

  it('accepts a complete receipt for the current stable recommendation scope', () => {
    expect(parseRecommendationApprovedEvent(scope, {
      recommendationId: 'rec-1',
      label: 'Replace dichloromethane with ethyl acetate',
      alreadyAccepted: false,
      actionId: 'action-1',
      revisionNumber: 4,
    })).toEqual({
      recommendationId: 'rec-1',
      label: 'Replace dichloromethane with ethyl acetate',
      alreadyAccepted: false,
      actionId: 'action-1',
      revisionNumber: 4,
    })
  })

  it.each([
    [{ kind: 'principle', principleNumber: 5 } as TalkAboutScope, 'rec-1'],
    [{ kind: 'recommendation', recommendationId: 'other-rec' } as TalkAboutScope, 'rec-1'],
    [scope, 'other-rec'],
  ])('ignores approval events outside the current stable recommendation scope', (eventScope, recommendationId) => {
    expect(parseRecommendationApprovedEvent(eventScope, {
      recommendationId,
      label: 'Replace dichloromethane with ethyl acetate',
      alreadyAccepted: false,
      actionId: 'action-1',
      revisionNumber: 4,
    })).toBeNull()
  })

  it.each([
    { recommendationId: 'rec-1', label: '', alreadyAccepted: false, actionId: 'action-1', revisionNumber: 4 },
    { recommendationId: 'rec-1', label: 'Replace dichloromethane with ethyl acetate', alreadyAccepted: 'false', actionId: 'action-1', revisionNumber: 4 },
    { recommendationId: 'rec-1', label: 'Replace dichloromethane with ethyl acetate', alreadyAccepted: false, actionId: '', revisionNumber: 4 },
    { recommendationId: 'rec-1', label: 'Replace dichloromethane with ethyl acetate', alreadyAccepted: false, actionId: 'action-1', revisionNumber: 4.5 },
  ])('ignores malformed approval receipts', data => {
    expect(parseRecommendationApprovedEvent(scope, data)).toBeNull()
  })
})

describe('approvalFromEvent', () => {
  const scope: TalkAboutScope = { kind: 'recommendation', recommendationId: 'rec-1' }

  it('extracts a matching stable-scope approval identity', () => {
    expect(approvalFromEvent({
      recommendationId: 'rec-1',
      label: 'Step 1: DMF → EtOAc',
      revisionNumber: 3,
    }, scope)).toEqual({
      recommendationId: 'rec-1',
      label: 'Step 1: DMF → EtOAc',
      revisionNumber: 3,
    })
  })

  it('ignores a mismatched stable-scope approval identity', () => {
    expect(approvalFromEvent({
      recommendationId: 'rec-2',
      revisionNumber: 3,
    }, scope)).toBeNull()
  })
})

describe('parsePersistedRecommendationApprovalReceipt', () => {
  it('hydrates a durable matching receipt with its persisted completion time', () => {
    expect(parsePersistedRecommendationApprovalReceipt({ kind: 'recommendation', recommendationId: 'rec-1' }, {
      actionId: 'action-persisted',
      recommendationId: 'rec-1',
      label: 'Use ethyl acetate',
      alreadyAccepted: true,
      revisionNumber: 9,
      receivedAt: '2026-08-12T00:00:00.000Z',
    })).toEqual({
      actionId: 'action-persisted',
      recommendationId: 'rec-1',
      label: 'Use ethyl acetate',
      alreadyAccepted: true,
      revisionNumber: 9,
      receivedAt: '2026-08-12T00:00:00.000Z',
    })
  })
})

describe('applyRecommendationApprovedEvent', () => {
  const scope: TalkAboutScope = { kind: 'recommendation', recommendationId: 'rec-1' }
  const receipt = {
    actionId: 'action-persisted',
    recommendationId: 'rec-1',
    label: 'Use ethyl acetate',
    alreadyAccepted: true,
    revisionNumber: 9,
  }

  it('restores a hydrated receipt when a repeat approved phrase returns the same action ID without notifying the parent again', () => {
    const result = applyRecommendationApprovedEvent(
      scope,
      receipt,
      new Set([receipt.actionId]),
    )

    expect(result.receipt).toEqual(receipt)
    expect(result.shouldNotifyParent).toBe(false)
  })

  it('keeps the display receipt absent and rejects a mismatched event', () => {
    const result = applyRecommendationApprovedEvent(scope, {
      ...receipt,
      recommendationId: 'other-rec',
    }, new Set([receipt.actionId]))

    expect(result.receipt).toBeNull()
    expect(result.shouldNotifyParent).toBe(false)
  })
})

describe('ApprovalReceiptCard', () => {
  it('renders a rehydrated receipt identity and revision', () => {
    const markup = renderToStaticMarkup(createElement(ApprovalReceiptCard, {
      receipt: {
        actionId: 'action-persisted',
        recommendationId: 'rec-1',
        label: 'Use ethyl acetate',
        alreadyAccepted: true,
        revisionNumber: 9,
      },
      receivedAt: '2026-08-12T00:00:00.000Z',
    }))

    expect(markup).toContain('Receipt action-persisted')
    expect(markup).toContain('revision 9')
  })
})
