import { describe, expect, it } from 'vitest'
import { buildTalkAboutContext, isProtocolTruncated } from '@/lib/talk-about-this/context'
import { buildTalkAboutSystemPrompt } from '@/lib/talk-about-this/prompt'
import {
  canDecideRecommendation,
  canProposeProcedureEdit,
  parseTalkAboutScope,
  scopesEqual,
  type TalkAboutScope,
} from '@/lib/talk-about-this/scope'
import { buildChatTools } from '@/lib/talk-about-this/tools'
import type { AnalysisResult } from '@/lib/types'

const analysis: AnalysisResult = {
  protocolTitle: 'Coupling',
  chemistrySubdomain: 'Organic synthesis',
  steps: [{
    stepNumber: 1,
    description: 'Dissolve the amine in brine and add reagent X-77.',
    chemicals: [
      { name: 'brine', role: 'solvent', quantity: '10 mL', quantityMl: 10, quantityKg: null },
      { name: 'reagent X-77', role: 'reagent', quantity: '1 g', quantityMl: null, quantityKg: 0.001 },
    ],
    conditions: { temperature: null, duration: null, atmosphere: null },
  }],
  recommendations: [{
    id: 'rec-1',
    stepNumber: 1,
    principleNumbers: [5],
    principleNames: ['Safer Solvents'],
    severity: 'high',
    original: { chemical: 'brine', issue: 'n/a' },
    alternative: { chemical: 'water', rationale: 'x', yieldImpact: 'x', caveats: 'x', evidenceBasis: 'x' },
    confidenceLevel: 'medium',
  }],
  enrichedChemicals: [
    { name: 'brine', role: 'solvent', quantity: '10 mL', quantityMl: 10, quantityKg: null, stepNumber: 1, reference_status: 'not_found' },
    { name: 'reagent X-77', role: 'reagent', quantity: '1 g', quantityMl: null, quantityKg: 0.001, stepNumber: 1, reference_status: 'provider_error' },
    { name: 'water', role: 'solvent', quantity: '5 mL', quantityMl: 5, quantityKg: null, stepNumber: 1, reference_status: 'found' },
  ],
  chemistryDataStatus: {
    pending: false,
    deterministicScoringAvailable: false,
    unresolvedChemicals: ['reagent X-77'],
    indefiniteChemicals: ['brine'],
    unresolvedDetails: [{ name: 'reagent X-77', reason: 'provider_error', stepNumber: 1, role: 'reagent' }],
    message: 'Scoring unavailable.',
  },
  revisedProtocol: '',
  overallAssessment: { greenPrinciplesViolated: [], mostImpactfulChange: '', experimentalValidationNeeded: true, disclaimer: '' },
}

describe('chemistry-clarification scope', () => {
  it('parses the contract shape, trimming and de-duplicating names', () => {
    expect(parseTalkAboutScope({
      kind: 'chemistry-clarification',
      issue: 'unresolved-compound',
      chemicals: ['  reagent X-77 ', 'reagent X-77', ''],
    })).toEqual({ kind: 'chemistry-clarification', issue: 'unresolved-compound', chemicals: ['reagent X-77'] })
  })

  it('allows an empty chemical list for whole-analysis problems', () => {
    expect(parseTalkAboutScope({ kind: 'chemistry-clarification', issue: 'scoring-unavailable', chemicals: [] }))
      .toEqual({ kind: 'chemistry-clarification', issue: 'scoring-unavailable', chemicals: [] })
  })

  it.each([
    [{ kind: 'chemistry-clarification', issue: 'something-else', chemicals: [] }],
    [{ kind: 'chemistry-clarification', issue: 'rescore-failed', chemicals: 'brine' }],
    [{ kind: 'chemistry-clarification', issue: 'rescore-failed', chemicals: [1] }],
    [{ kind: 'chemistry-clarification', issue: 'rescore-failed', chemicals: Array.from({ length: 11 }, (_, index) => `c${index}`) }],
    [{ kind: 'chemistry-clarification', issue: 'rescore-failed', chemicals: ['x'.repeat(121)] }],
  ])('rejects invalid scope %j', value => {
    expect(() => parseTalkAboutScope(value)).toThrow()
  })

  it('accepts ten names of exactly 120 characters', () => {
    const chemicals = Array.from({ length: 10 }, (_, index) => `${index}`.repeat(120).slice(0, 120))
    expect(parseTalkAboutScope({ kind: 'chemistry-clarification', issue: 'unresolved-compound', chemicals })).toMatchObject({ chemicals })
  })

  it('builds protocol-level context with every step, reference statuses and chemistry data status', () => {
    const context = buildTalkAboutContext({
      analysisId: 'analysis-1',
      protocolText: 'Dissolve the amine in brine.',
      analysis,
      scope: { kind: 'chemistry-clarification', issue: 'unresolved-compound', chemicals: ['reagent X-77', 'Brine'] },
    })

    expect(context.steps).toEqual(analysis.steps)
    expect(context.recommendations).toEqual([])
    expect(context.referenceStatuses).toEqual([
      { name: 'brine', stepNumber: 1, referenceStatus: 'not_found' },
      { name: 'reagent X-77', stepNumber: 1, referenceStatus: 'provider_error' },
    ])
    expect(context.chemistryDataStatus).toMatchObject({
      unresolvedChemicals: ['reagent X-77'],
      unresolvedDetails: [{ name: 'reagent X-77', reason: 'provider_error' }],
    })
  })

  it('rejects chemicals that are not part of the saved analysis', () => {
    expect(() => buildTalkAboutContext({
      analysisId: 'analysis-1',
      protocolText: 'Dissolve the amine in brine.',
      analysis,
      scope: { kind: 'chemistry-clarification', issue: 'unresolved-compound', chemicals: ['plutonium'] },
    })).toThrow('not part of this analysis')
  })

  it('accepts a name that is only flagged in the chemistry data status', () => {
    const flaggedOnly: AnalysisResult = {
      ...analysis,
      chemistryDataStatus: { ...analysis.chemistryDataStatus!, unresolvedChemicals: ['mystery oil'] },
    }
    const context = buildTalkAboutContext({
      analysisId: 'analysis-1',
      protocolText: 'x',
      analysis: flaggedOnly,
      scope: { kind: 'chemistry-clarification', issue: 'unresolved-compound', chemicals: ['mystery oil'] },
    })

    expect(context.referenceStatuses).toEqual([])
  })
})

describe('scope helpers', () => {
  const scopes: Record<string, TalkAboutScope> = {
    stable: { kind: 'recommendation', recommendationId: 'rec-1' },
    readOnly: { kind: 'recommendation', recommendationIndex: 0, readOnly: true },
    principle: { kind: 'principle', principleNumber: 5 },
    empty: { kind: 'no-recommendations' },
    clarification: { kind: 'chemistry-clarification', issue: 'rescore-failed', chemicals: [] },
  }

  it('lets only a stable recommendation scope approve or reject', () => {
    expect(Object.entries(scopes).filter(([, scope]) => canDecideRecommendation(scope)).map(([name]) => name)).toEqual(['stable'])
  })

  it('lets every scope propose a procedure edit except the read-only index scope', () => {
    expect(Object.entries(scopes).filter(([, scope]) => !canProposeProcedureEdit(scope)).map(([name]) => name)).toEqual(['readOnly'])
  })

  it('compares scopes by canonical content', () => {
    expect(scopesEqual(scopes.clarification, { kind: 'chemistry-clarification', chemicals: [], issue: 'rescore-failed' })).toBe(true)
    expect(scopesEqual(scopes.stable, { kind: 'recommendation', recommendationId: 'rec-2' })).toBe(false)
    expect(scopesEqual(scopes.stable, scopes.readOnly)).toBe(false)
    expect(scopesEqual(scopes.clarification, { kind: 'chemistry-clarification', issue: 'rescore-failed', chemicals: ['brine'] })).toBe(false)
  })
})

describe('protocol truncation in the frozen context', () => {
  it('detects a truncated snapshot so the route can load the full saved text', () => {
    const long = buildTalkAboutContext({
      analysisId: 'analysis-1',
      protocolText: 'a'.repeat(12_001),
      analysis,
      scope: { kind: 'no-recommendations' },
    })
    const short = buildTalkAboutContext({ analysisId: 'analysis-1', protocolText: 'short', analysis, scope: { kind: 'no-recommendations' } })

    expect(isProtocolTruncated(long)).toBe(true)
    expect(isProtocolTruncated(short)).toBe(false)
  })
})

describe('proposal tool exposure', () => {
  function toolNames(scope: TalkAboutScope): string[] {
    const context = buildTalkAboutContext({ analysisId: 'analysis-1', protocolText: 'Dissolve the amine in brine.', analysis, scope: scope.kind === 'recommendation' && 'recommendationIndex' in scope ? { kind: 'recommendation', recommendationId: 'rec-1' } : scope })
    // The read-only scope keeps its marker on the context so tool exposure follows the scope, not the lookup.
    return buildChatTools({ ...context, scope }).map(tool => tool.function.name)
  }

  it.each(['stable', 'principle', 'empty', 'clarification'] as const)('offers propose_procedure_edit for the %s scope', name => {
    const scopes = {
      stable: { kind: 'recommendation', recommendationId: 'rec-1' },
      principle: { kind: 'principle', principleNumber: 5 },
      empty: { kind: 'no-recommendations' },
      clarification: { kind: 'chemistry-clarification', issue: 'unresolved-compound', chemicals: ['brine'] },
    } satisfies Record<string, TalkAboutScope>
    expect(toolNames(scopes[name])).toContain('propose_procedure_edit')
  })

  it('never offers propose_procedure_edit to a read-only scope', () => {
    expect(toolNames({ kind: 'recommendation', recommendationIndex: 0, readOnly: true })).not.toContain('propose_procedure_edit')
  })

  it('bounds the schema to 1-10 edits of find, replace and rationale', () => {
    const context = buildTalkAboutContext({ analysisId: 'analysis-1', protocolText: 'x', analysis, scope: { kind: 'no-recommendations' } })
    const tool = buildChatTools(context).find(candidate => candidate.function.name === 'propose_procedure_edit')!

    expect(tool.function.parameters.required).toEqual(['summary', 'edits'])
    expect(tool.function.parameters.properties.edits).toMatchObject({ minItems: 1, maxItems: 10, items: { required: ['find', 'replace', 'rationale'] } })
    expect(tool.function.description).toContain('PROPOSES')
  })
})

describe('system prompt authority rules', () => {
  function promptFor(scope: TalkAboutScope, options?: { fullProcedureText?: string }): string {
    const context = buildTalkAboutContext({
      analysisId: 'analysis-1',
      protocolText: 'Dissolve the amine in brine.',
      analysis,
      scope: scope.kind === 'recommendation' && 'recommendationIndex' in scope ? { kind: 'recommendation', recommendationId: 'rec-1' } : scope,
    })
    return buildTalkAboutSystemPrompt({ ...context, scope }, [], options)
  }

  it('keeps recommendation decisions phrase-only and out of the model’s hands', () => {
    const prompt = promptFor({ kind: 'recommendation', recommendationId: 'rec-1' })

    expect(prompt).toContain('exactly “approve this” or “reject this”')
    expect(prompt).toContain('Never say it has been approved or rejected')
    expect(prompt).toContain('You cannot approve, reject, apply or change anything yourself')
    expect(prompt).toContain('Never claim a saved action occurred unless a server-generated receipt explicitly says it did')
  })

  it('makes procedure changes proposal-only with the exact apply copy', () => {
    const prompt = promptFor({ kind: 'principle', principleNumber: 5 })

    expect(prompt).toContain('propose_procedure_edit')
    expect(prompt).toContain('PROPOSED, NOT APPLIED')
    expect(prompt).toContain('creates a new analysis and uses one analysis run')
    expect(prompt).toContain('Never state that the procedure was changed or re-analysed')
    expect(prompt).not.toContain('approve this')
  })

  it('tells a read-only discussion it can do nothing', () => {
    const prompt = promptFor({ kind: 'recommendation', recommendationIndex: 0, readOnly: true })

    expect(prompt).toContain('This discussion is read-only')
    expect(prompt).not.toContain('propose_procedure_edit')
    expect(prompt).not.toContain('exactly “approve this”')
  })

  it('separates unrecognised, recognised-without-reference, and provider-outage cases for clarifications', () => {
    const prompt = promptFor({ kind: 'chemistry-clarification', issue: 'unresolved-compound', chemicals: ['reagent X-77'] })

    expect(prompt).toContain('reagent X-77')
    expect(prompt).toContain('the name was not recognised')
    expect(prompt).toContain('recognised but reference data is missing')
    expect(prompt).toContain('data provider was unavailable')
    expect(prompt).toContain('more precise name or its CAS number')
    expect(prompt).toContain('offer to propose a procedure edit')
    expect(prompt).toContain('referenceStatuses')
  })

  it('substitutes the complete saved procedure for the truncated snapshot when given', () => {
    const prompt = promptFor({ kind: 'principle', principleNumber: 5 }, { fullProcedureText: 'FULL TEXT WITH TAIL-UNIQUE-MARKER' })

    expect(prompt).toContain('TAIL-UNIQUE-MARKER')
    expect(prompt).toContain('complete saved procedure')
    expect(prompt).not.toContain('Dissolve the amine in brine.')
  })
})
