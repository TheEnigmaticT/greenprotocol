import { describe, expect, it, vi } from 'vitest'
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
        mode: { type: 'string' },
        solute: { type: 'string', enum: expect.arrayContaining(['DMF', 'Cyrene']) },
        solvent: { type: 'string', enum: expect.arrayContaining(['DMF', 'Cyrene', 'Ethyl acetate']) },
        temperatureK: { type: 'number' },
      },
      oneOf: expect.arrayContaining([
        expect.objectContaining({
          required: ['mode', 'solvent', 'temperatureK'],
          properties: expect.objectContaining({
            mode: { type: 'string', enum: ['density'] },
            solvent: { type: 'string', enum: expect.arrayContaining(['Ethyl acetate']) },
          }),
        }),
        expect.objectContaining({
          required: ['mode', 'solute', 'solvent', 'temperatureK'],
          properties: expect.objectContaining({
            mode: { type: 'string', enum: ['single_solubility'] },
            solvent: { type: 'string', enum: expect.arrayContaining(['DMF', 'Cyrene']) },
          }),
        }),
        expect.objectContaining({
          required: ['mode', 'solute', 'solvent', 'coSolvent', 'fractionSolvent', 'fractionType', 'temperatureK'],
          properties: expect.objectContaining({
            mode: { type: 'string', enum: ['mixture_solubility'] },
            solvent: { type: 'string', enum: expect.arrayContaining(['DMF', 'Cyrene']) },
          }),
        }),
      ]),
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

it('permits a locally indexed density solvent but rejects it for scoped solubility', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    operation: 'solvent_evidence',
    chemical_name: 'Ethyl acetate',
    status: 'ok',
    source: 'Local solvent evidence',
    data: { measurements: [] },
    citations: [],
    warnings: [],
  })))
  vi.stubGlobal('fetch', fetchMock)

  try {
    await expect(executeScopedTool(
      context,
      {
        id: 'density-1',
        name: 'lookup_experimental_solvent_evidence',
        mode: 'density',
        solvent: 'Ethyl acetate',
        temperatureK: 298.15,
      },
    )).resolves.toMatchObject({ status: 'ok' })
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      body: JSON.stringify({
        operation: 'solvent_evidence',
        mode: 'density',
        solvent: 'Ethyl acetate',
        temperature_k: 298.15,
      }),
    }))
  } finally {
    vi.unstubAllGlobals()
  }

  await expect(executeScopedTool(
    context,
    {
      id: 'solubility-1',
      name: 'lookup_experimental_solvent_evidence',
      mode: 'single_solubility',
      solute: 'DMF',
      solvent: 'Ethyl acetate',
      temperatureK: 298.15,
      canonicalSoluteSmiles: 'CN(C)C=O',
    },
  )).rejects.toThrow('outside this scoped discussion')
})
