import { describe, expect, it } from 'vitest'
import {
  buildChemicalContext,
  buildPrincipleUserMessage,
  PRINCIPLES,
} from '@/lib/prompts/principles'
import type { AnalysisStep, EnrichedChemical } from '@/lib/types'

const steps: AnalysisStep[] = [{
  stepNumber: 1,
  description: 'Use Hydrated-only reagent.',
  chemicals: [{
    name: 'Hydrated-only reagent',
    role: 'reagent',
    quantity: '1 g',
    quantityMl: null,
    quantityKg: null,
  }],
  conditions: { temperature: null, duration: null, atmosphere: null },
}]

const hydratedOnly: EnrichedChemical[] = [{
  ...steps[0].chemicals[0],
  data_source: 'pubchem',
  ghs_hazards: [{
    code: 'H350',
    description: 'May cause cancer',
    source: 'PubChem',
  }],
  green_alternatives: [],
  molecular_formula: 'C2H6O',
  smiles: 'CCO',
  molecular_weight: 46.07,
  density_g_per_ml: 0.789,
  citations: [{
    source_id: 'pubchem:123', source_name: 'PubChem', citation: 'PubChem CID 123',
    doi: '10.1000/example', url: 'https://example.test/citation',
  }],
}]

describe('principle chemistry evidence context', () => {
  it('uses hydrated evidence for a chemical absent from the static database', () => {
    const context = buildChemicalContext(steps, hydratedOnly)

    expect(context).toContain('Hydrated-only reagent')
    expect(context).toContain('Evidence provenance: hydrated chemistry service (pubchem)')
    expect(context).toContain('H350')
    expect(context).toContain('formula C2H6O')
    expect(context).toContain('SMILES CCO')
    expect(context).toContain('source_id=pubchem:123')
    expect(context).toContain('doi=10.1000/example')
    expect(context).toContain('url=https://example.test/citation')
    expect(context).not.toContain('Not in our database. Use your chemistry knowledge.')
  })

  it('labels unavailable enrichment and never represents missing hazards as safe', () => {
    const unavailable: EnrichedChemical[] = [{
      ...steps[0].chemicals[0],
      data_source: 'error',
      ghs_hazards: [],
      green_alternatives: [],
      citations: [],
    }]

    const context = buildChemicalContext(steps, unavailable)

    expect(context).toContain('Chemistry service enrichment unavailable (error)')
    expect(context).toContain('Do not infer that this chemical is safe')
    expect(context).not.toContain('GHS hazards: none listed')
  })

  it('labels absent hydration as missing evidence rather than a safe chemical', () => {
    const context = buildChemicalContext(steps)

    expect(context).toContain('Hydrated chemistry evidence was not supplied for this chemical')
    expect(context).toContain('Do not infer that this chemical is safe')
  })

  it('treats queued hydration as unavailable even if a data source is present', () => {
    const queued: EnrichedChemical[] = [{
      ...hydratedOnly[0],
      data_source: 'pubchem',
      reference_status: 'queued',
    }]

    const context = buildChemicalContext(steps, queued)

    expect(context).toContain('Chemistry service enrichment unavailable (queued)')
    expect(context).toContain('Do not infer that this chemical is safe')
    expect(context).not.toContain('Evidence provenance: hydrated chemistry service (pubchem)')
  })

  it('places hydrated evidence in the actual principle user message', () => {
    const message = buildPrincipleUserMessage(PRINCIPLES[2], steps, hydratedOnly)

    expect(message).toContain('Hydrated-only reagent')
    expect(message).toContain('Evidence provenance: hydrated chemistry service (pubchem)')
  })
})
