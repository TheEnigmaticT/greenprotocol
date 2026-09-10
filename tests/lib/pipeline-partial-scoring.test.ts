import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  batchConvert: vi.fn(),
  scoreProtocol: vi.fn(),
  isServiceAvailable: vi.fn(),
  evidenceSearch: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mocks.anthropicCreate }
  },
}))

vi.mock('@/lib/chemistry-service', () => ({
  batchConvert: mocks.batchConvert,
  scoreProtocol: mocks.scoreProtocol,
  isServiceAvailable: mocks.isServiceAvailable,
}))

vi.mock('@/lib/literature-evidence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/literature-evidence')>('@/lib/literature-evidence')
  return {
    ...actual,
    searchLiteratureEvidence: mocks.evidenceSearch,
    citationFromEvidenceMatch: () => ({ source_id: 'test', source_name: 'Test', citation: 'Test.' }),
  }
})

import { analyzeProtocol } from '@/lib/pipeline'

function response(input: Record<string, unknown>) {
  return {
    content: [{ id: 'tool', type: 'tool_use', name: 'return_result', input }],
    usage: { input_tokens: 1, output_tokens: 1 },
    stop_reason: 'tool_use',
  }
}

const scoreResult = {
  grade: 'B',
  total_score: 20,
  max_possible: 120,
  smiles_extraction: {},
  yield_extraction: {},
  scores: [{
    principle_number: 8,
    principle_name: 'Reduce Derivatives',
    score: 5,
    max_score: 10,
    normalized: 0.5,
    details: {},
    chemicals_flagged: [],
    data_sources: ['ai_assessment'],
    confidence: 'calculated',
  }],
}

describe('partial chemistry reference data', () => {
  beforeEach(() => {
    mocks.isServiceAvailable.mockResolvedValue(true)
    mocks.batchConvert.mockResolvedValue({
      results: [
        {
          chemical_name: 'brine', smiles: null, molecular_formula: null,
          molecular_weight: null, density_g_per_ml: null, quantity_g: null,
          quantity_kg: null, quantity_mol: null, ghs_hazards: [], green_alternatives: [],
          citations: [], data_source: 'indefinite', cached: false, warnings: [], error: null,
        },
      ],
    })
    mocks.scoreProtocol.mockResolvedValue(scoreResult)
    mocks.evidenceSearch.mockResolvedValue([])
    mocks.anthropicCreate.mockImplementation(({ system }: { system: string }) => {
      if (system.includes('protocol writer')) {
        return Promise.resolve(response({
          revisedProtocol: 'Revised protocol.',
          overallAssessment: {
            greenPrinciplesViolated: [], mostImpactfulChange: 'None.',
            experimentalValidationNeeded: true, disclaimer: 'Validate experimentally.',
          },
        }))
      }
      if (system.includes('critical re-evaluation')) {
        return Promise.resolve(response({
          action: 'confirm', revisedConfidence: 'medium', revisedRationale: 'No change.',
          evidenceAssessment: { supportsOriginalIssue: false, supportsAlternative: false, contextMatch: 'none', quantitativeData: false },
          concerns: [],
        }))
      }
      if (system.includes('protocol parser')) {
        return Promise.resolve(response({
          protocolTitle: 'Brine workup', chemistrySubdomain: 'Organic synthesis',
          steps: [{ stepNumber: 1, description: 'Wash with brine.', chemicals: [{ name: 'brine', role: 'workup', quantity: '10 mL' }], conditions: {} }],
        }))
      }
      return Promise.resolve(response({ principleNumber: 5, recommendations: [] }))
    })
  })

  it('still calls the scorer when an indefinite workup material is present', async () => {
    const analysis = await analyzeProtocol('Wash the product with brine.')

    expect(mocks.scoreProtocol).toHaveBeenCalledOnce()
    expect(analysis.deterministicScores).toEqual(scoreResult)
    expect(analysis.chemistryDataStatus).toMatchObject({
      pending: false,
      deterministicScoringAvailable: true,
      indefiniteChemicals: ['brine'],
    })
  })

  it('keeps repeated material quantities scoped to their parsed step', async () => {
    mocks.batchConvert.mockResolvedValue({ results: [
      { chemical_name: 'ethanol', smiles: 'CCO', molecular_formula: 'C2H6O', molecular_weight: 46, density_g_per_ml: null, quantity_g: null, quantity_kg: null, quantity_mol: null, ghs_hazards: [], green_alternatives: [], citations: [], data_source: 'pubchem', cached: false, warnings: [], error: null },
      { chemical_name: 'ethanol', smiles: 'CCO', molecular_formula: 'C2H6O', molecular_weight: 46, density_g_per_ml: null, quantity_g: null, quantity_kg: null, quantity_mol: null, ghs_hazards: [], green_alternatives: [], citations: [], data_source: 'pubchem', cached: false, warnings: [], error: null },
    ] })
    mocks.anthropicCreate.mockImplementation(({ system }: { system: string }) => {
      if (system.includes('protocol writer')) return Promise.resolve(response({ revisedProtocol: 'Revised protocol.', overallAssessment: { greenPrinciplesViolated: [], mostImpactfulChange: 'None.', experimentalValidationNeeded: true, disclaimer: 'Validate experimentally.' } }))
      if (system.includes('protocol parser')) return Promise.resolve(response({ protocolTitle: 'Repeated ethanol', chemistrySubdomain: 'Organic synthesis', steps: [
        { stepNumber: 1, description: 'Add ethanol (1 g).', chemicals: [{ name: 'ethanol', role: 'solvent', quantity: '1 g', quantityKg: 0.001 }], conditions: {} },
        { stepNumber: 2, description: 'Add ethanol (2 g).', chemicals: [{ name: 'ethanol', role: 'solvent', quantity: '2 g', quantityKg: 0.002 }], conditions: {} },
      ] }))
      return Promise.resolve(response({ principleNumber: 5, recommendations: [] }))
    })

    await analyzeProtocol('Add ethanol (1 g). Add ethanol (2 g).')

    expect(mocks.scoreProtocol).toHaveBeenCalledWith(expect.objectContaining({
      chemicals: expect.arrayContaining([
        expect.objectContaining({ step_number: 1, name: 'ethanol', quantity_kg: 0.001, quantity_g: 1, quantity_mol: 1 / 46 }),
        expect.objectContaining({ step_number: 2, name: 'ethanol', quantity_kg: 0.002, quantity_g: 2, quantity_mol: 2 / 46 }),
      ]),
    }))
  })

  it('matches a reordered enrichment batch by chemical identity, never its returned position', async () => {
    mocks.batchConvert.mockResolvedValue({ results: [
      { chemical_name: 'acetone', smiles: 'CC(=O)C', molecular_formula: 'C3H6O', molecular_weight: 58, density_g_per_ml: null, quantity_g: null, quantity_kg: null, quantity_mol: null, ghs_hazards: [], green_alternatives: [], citations: [], data_source: 'pubchem', cached: false, warnings: [], error: null },
      { chemical_name: 'ethanol', smiles: 'CCO', molecular_formula: 'C2H6O', molecular_weight: 46, density_g_per_ml: null, quantity_g: null, quantity_kg: null, quantity_mol: null, ghs_hazards: [], green_alternatives: [], citations: [], data_source: 'pubchem', cached: false, warnings: [], error: null },
    ] })
    mocks.anthropicCreate.mockImplementation(({ system }: { system: string }) => {
      if (system.includes('protocol writer')) return Promise.resolve(response({ revisedProtocol: 'Revised protocol.', overallAssessment: { greenPrinciplesViolated: [], mostImpactfulChange: 'None.', experimentalValidationNeeded: true, disclaimer: 'Validate experimentally.' } }))
      if (system.includes('protocol parser')) return Promise.resolve(response({ protocolTitle: 'Reordered enrichment', chemistrySubdomain: 'Organic synthesis', steps: [{ stepNumber: 1, description: 'Add ethanol (46 g) and acetone (58 g).', chemicals: [{ name: 'ethanol', role: 'solvent', quantity: '46 g', quantityKg: 0.046 }, { name: 'acetone', role: 'solvent', quantity: '58 g', quantityKg: 0.058 }], conditions: {} }] }))
      return Promise.resolve(response({ principleNumber: 5, recommendations: [] }))
    })

    await analyzeProtocol('Add ethanol (46 g) and acetone (58 g).')

    expect(mocks.scoreProtocol).toHaveBeenCalledWith(expect.objectContaining({
      chemicals: expect.arrayContaining([
        expect.objectContaining({ name: 'ethanol', quantity_mol: 1 }),
        expect.objectContaining({ name: 'acetone', quantity_mol: 1 }),
      ]),
    }))
  })

  it('binds canonical alias responses to their requested occurrence after batch reordering', async () => {
    mocks.batchConvert.mockResolvedValue({ results: [
      { request_id: '2:0', requested_chemical_name: 'Pd(PPh3)4', chemical_name: 'Tetrakis(triphenylphosphine)palladium(0)', smiles: 'P(c1ccccc1)(c1ccccc1)(c1ccccc1)[Pd]P(c1ccccc1)(c1ccccc1)c1ccccc1', molecular_formula: 'C72H60P4Pd', molecular_weight: 1155.56, density_g_per_ml: null, quantity_g: 0.0115556, quantity_kg: 0.0000115556, quantity_mol: 0.00001, ghs_hazards: [], green_alternatives: [], citations: [], data_source: 'pubchem', cached: false, warnings: [], error: null },
      { request_id: '1:0', requested_chemical_name: 'DMF', chemical_name: 'N,N-Dimethylformamide', smiles: 'CN(C)C=O', molecular_formula: 'C3H7NO', molecular_weight: 73.09, density_g_per_ml: null, quantity_g: 73.09, quantity_kg: 0.07309, quantity_mol: 1, ghs_hazards: [], green_alternatives: [], citations: [], data_source: 'pubchem', cached: false, warnings: [], error: null },
    ] })
    mocks.anthropicCreate.mockImplementation(({ system }: { system: string }) => {
      if (system.includes('protocol writer')) return Promise.resolve(response({ revisedProtocol: 'Revised protocol.', overallAssessment: { greenPrinciplesViolated: [], mostImpactfulChange: 'None.', experimentalValidationNeeded: true, disclaimer: 'Validate experimentally.' } }))
      if (system.includes('protocol parser')) return Promise.resolve(response({ protocolTitle: 'Alias-preserving Suzuki', chemistrySubdomain: 'Organic synthesis', steps: [
        { stepNumber: 1, description: 'Add DMF (73.09 g).', chemicals: [{ name: 'DMF', role: 'solvent', quantity: '73.09 g', quantityKg: 0.07309 }], conditions: {} },
        { stepNumber: 2, description: 'Add Pd(PPh3)4 (11.5556 mg).', chemicals: [{ name: 'Pd(PPh3)4', role: 'catalyst', quantity: '11.5556 mg', quantityKg: 0.0000115556 }], conditions: {} },
      ] }))
      return Promise.resolve(response({ principleNumber: 5, recommendations: [] }))
    })

    const analysis = await analyzeProtocol('Add DMF (73.09 g). Add Pd(PPh3)4 (11.5556 mg).')

    expect(mocks.batchConvert).toHaveBeenCalledWith([
      { name: 'DMF', quantity: '73.09 g', requestId: '1:0' },
      { name: 'Pd(PPh3)4', quantity: '11.5556 mg', requestId: '2:0' },
    ])
    expect(analysis.enrichedChemicals).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'DMF', canonical_name: 'N,N-Dimethylformamide', molecular_formula: 'C3H7NO' }),
      expect.objectContaining({ name: 'Pd(PPh3)4', canonical_name: 'Tetrakis(triphenylphosphine)palladium(0)', molecular_formula: 'C72H60P4Pd' }),
    ]))
    const scored = mocks.scoreProtocol.mock.calls.at(-1)?.[0]?.chemicals
    expect(scored).toEqual(expect.arrayContaining([
      expect.objectContaining({ step_number: 1, name: 'DMF', quantity_kg: 0.07309, quantity_mol: 1 }),
      expect.objectContaining({ step_number: 2, name: 'Pd(PPh3)4', quantity_kg: 0.0000115556 }),
    ]))
    expect(scored.find((chemical: { name: string }) => chemical.name === 'Pd(PPh3)4').quantity_mol).toBeCloseTo(0.00001, 12)
  })

  it('keeps a missing occurrence explicitly unresolved instead of borrowing a canonical alias response', async () => {
    mocks.batchConvert.mockResolvedValue({ results: [{
      request_id: '1:0', requested_chemical_name: 'DMF', chemical_name: 'N,N-Dimethylformamide', smiles: 'CN(C)C=O', molecular_formula: 'C3H7NO', molecular_weight: 73.09, density_g_per_ml: null, quantity_g: 73.09, quantity_kg: 0.07309, quantity_mol: 1, ghs_hazards: [], green_alternatives: [], citations: [], data_source: 'pubchem', cached: false, warnings: [], error: null,
    }] })
    mocks.anthropicCreate.mockImplementation(({ system }: { system: string }) => {
      if (system.includes('protocol writer')) return Promise.resolve(response({ revisedProtocol: 'Revised protocol.', overallAssessment: { greenPrinciplesViolated: [], mostImpactfulChange: 'None.', experimentalValidationNeeded: true, disclaimer: 'Validate experimentally.' } }))
      if (system.includes('protocol parser')) return Promise.resolve(response({ protocolTitle: 'Missing alias response', chemistrySubdomain: 'Organic synthesis', steps: [{ stepNumber: 1, description: 'Add DMF and unknown alias.', chemicals: [{ name: 'DMF', role: 'solvent', quantity: '73.09 g', quantityKg: 0.07309 }, { name: 'unknown alias', role: 'additive', quantity: '1 g', quantityKg: 0.001 }], conditions: {} }] }))
      return Promise.resolve(response({ principleNumber: 5, recommendations: [] }))
    })

    const analysis = await analyzeProtocol('Add DMF and unknown alias.')

    expect(analysis.enrichedChemicals).toEqual([expect.objectContaining({ name: 'DMF', canonical_name: 'N,N-Dimethylformamide' })])
    expect(analysis.chemistryDataStatus?.unresolvedChemicals).toEqual(['unknown alias'])
    const scored = mocks.scoreProtocol.mock.calls.at(-1)?.[0]?.chemicals
    expect(scored).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'unknown alias', quantity_kg: 0.001, molecular_weight: null, quantity_mol: null }),
    ]))
  })

  it('passes hydrated chemistry evidence into every principle evaluation', async () => {
    mocks.batchConvert.mockResolvedValue({
      results: [{
        chemical_name: 'brine', smiles: null, molecular_formula: null,
        molecular_weight: null, density_g_per_ml: null, quantity_g: null,
        quantity_kg: null, quantity_mol: null,
        ghs_hazards: [{ code: 'H350', description: 'May cause cancer', source: 'PubChem' }],
        green_alternatives: [],
        citations: [{ source_id: 'pubchem:123', source_name: 'PubChem', citation: 'PubChem CID 123', url: 'https://example.test/citation' }],
        data_source: 'pubchem', reference_status: 'available', cached: false,
        warnings: [], error: null,
      }],
    })

    const callsBefore = mocks.anthropicCreate.mock.calls.length
    await analyzeProtocol('Wash the product with brine.')

    const principleCalls = mocks.anthropicCreate.mock.calls.slice(callsBefore).filter(
      ([options]) => typeof options?.system === 'string' && options.system.includes('green chemistry expert specializing'),
    )
    expect(principleCalls).toHaveLength(12)
    for (const [options] of principleCalls) {
      expect(options.messages[0].content).toContain('Evidence provenance: hydrated chemistry service (pubchem)')
      expect(options.messages[0].content).toContain('H350 (May cause cancer) [PubChem]')
      expect(options.messages[0].content).toContain('source_id=pubchem:123')
    }
  })
})
