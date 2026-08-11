import { describe, expect, it } from 'vitest'
import { buildChatTools, executeScopedTool } from '@/lib/talk-about-this/tools'
import type { TalkAboutContext } from '@/lib/talk-about-this/context'

const context = {
  schemaVersion: 1,
  analysisId: 'analysis-1',
  scope: { kind: 'recommendation', recommendationId: 'rec-1' },
  protocolTitle: 'Suzuki coupling',
  protocolText: 'Use DMF with phenylboronic acid.',
  steps: [{ stepNumber: 1, description: 'Use DMF.', chemicals: [{ name: 'DMF', role: 'solvent' }], conditions: {} }],
  recommendations: [{
    id: 'rec-1', stepNumber: 1, principleNumbers: [5], principleNames: ['Safer Solvents'], severity: 'high',
    original: { chemical: 'DMF', issue: 'Hazardous solvent' },
    alternative: { chemical: 'Cyrene', rationale: 'Lower hazard', yieldImpact: 'Validate', caveats: 'Viscosity', evidenceBasis: 'CHEM21' },
    confidenceLevel: 'medium',
  }],
  scores: [], citations: [], noDirectEvidence: true, contextHash: 'a'.repeat(64),
} satisfies TalkAboutContext

describe('buildChatTools', () => {
  it('keeps live chemistry tools scoped while local evidence tools may inspect indexed solvents', () => {
    const tools = buildChatTools(context)
    const byName = Object.fromEntries(tools.map(tool => [tool.function.name, tool.function]))

    expect(Object.keys(byName)).toEqual(expect.arrayContaining([
      'lookup_experimental_solvent_evidence',
      'lookup_solvent_hazard_profile',
      'screen_solvent_candidates',
    ]))
    expect(byName.lookup_chem21_solvent.parameters.properties.chemical.enum).toEqual(expect.arrayContaining(['DMF', 'Cyrene', 'Ethyl acetate']))
    expect(byName.lookup_pubchem_profile.parameters.properties.chemical.enum).not.toContain('Ethyl acetate')
    expect(byName.calculate_rdkit_properties.parameters.properties.chemical.enum).not.toContain('Ethyl acetate')
    expect(byName.lookup_solvent_hazard_profile.parameters).toMatchObject({
      additionalProperties: false,
      required: ['solvent'],
      properties: { solvent: { type: 'string', enum: expect.arrayContaining(['Ethyl acetate']) } },
    })
  })

  it('uses closed schemas for local solvent evidence and screening', () => {
    const tools = buildChatTools(context)
    const byName = Object.fromEntries(tools.map(tool => [tool.function.name, tool.function]))

    expect(byName.lookup_experimental_solvent_evidence.parameters).toMatchObject({
      additionalProperties: false,
      properties: {
        mode: { type: 'string', enum: ['single_solubility', 'mixture_solubility', 'density'] },
        solute: { type: 'string', enum: expect.arrayContaining(['DMF', 'Cyrene']) },
        solvent: { type: 'string', enum: expect.arrayContaining(['DMF', 'Cyrene']) },
        temperatureK: { type: 'number' },
      },
    })
    expect(byName.screen_solvent_candidates.parameters).toMatchObject({
      additionalProperties: false,
      required: ['solute', 'currentSolvent', 'temperatureK'],
      properties: {
        solute: { type: 'string', enum: expect.arrayContaining(['DMF', 'Cyrene']) },
        currentSolvent: { type: 'string', enum: expect.arrayContaining(['DMF', 'Cyrene']) },
        temperatureK: { type: 'number' },
      },
    })
  })
})


it('rejects a requested chemical outside the frozen context', async () => {
  await expect(executeScopedTool(
    context,
    { id: 'call-1', name: 'lookup_pubchem_profile', chemical: 'benzene' },
  )).rejects.toThrow('outside this scoped discussion')
})

it('rejects screening with an out-of-scope solute', async () => {
  await expect(executeScopedTool(
    context,
    {
      id: 'call-2',
      name: 'screen_solvent_candidates',
      solute: 'benzene',
      currentSolvent: 'DMF',
      temperatureK: 298.15,
    } as never,
  )).rejects.toThrow('outside this scoped discussion')
})
