import { describe, expect, it } from 'vitest'
import { activityForEvent, approvalFromEvent, evidenceFromEvent, parseRecommendationApprovedEvent } from '@/components/TalkAboutThis'
import { activityData } from '@/lib/talk-about-this/agent'
import type { TalkAboutScope } from '@/lib/talk-about-this/context'
import { buildTalkAboutSystemPrompt } from '@/lib/talk-about-this/prompt'
import type { TalkAboutContext } from '@/lib/talk-about-this/context'

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

  it('ignores malformed evidence records', () => {
    expect(evidenceFromEvent('tool-complete', {
      evidence: [{ ...evidence, pageStart: '12' }],
    })).toEqual([])
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
