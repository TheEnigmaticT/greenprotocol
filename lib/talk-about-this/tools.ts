import type { TalkAboutContext } from '@/lib/talk-about-this/context'
import { citationFromEvidenceMatch, searchLiteratureEvidence } from '@/lib/literature-evidence'
import type { Citation, EvidenceSignalGroup, LiteratureEvidenceMatch } from '@/lib/types'

export const TOOL_NAMES = [
  'lookup_chem21_solvent',
  'lookup_pubchem_profile',
  'calculate_rdkit_properties',
  'lookup_experimental_solvent_evidence',
  'lookup_solvent_hazard_profile',
  'screen_solvent_candidates',
  'search_scoped_literature_evidence',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]
type EvidenceMode = 'single_solubility' | 'mixture_solubility' | 'density'

const LOCAL_INDEXED_SOLVENTS = [
  '1,2-Dichloroethane', '1,2-Dimethoxyethane', '1,3-Dimethyl-3,4,5,6-tetrahydro-2(1H)-pyrimidinone',
  '2-Methoxyethanol', 'Acetic acid', 'Acetic anhydride', 'Acetone', 'Acetonitrile', 'Anisole', 'Benzene',
  'Benzyl alcohol', 'Carbon disulfide', 'Carbon tetrachloride', 'Chlorobenzene', 'Chloroform', 'Cyclohexane',
  'Cyclohexanone', 'Dichloromethane', 'Diethyl ether', 'Diisopropyl ether', 'Dimethyl sulfoxide', 'Dioxane',
  'Ethanol', 'Ethyl acetate', 'Ethylene glycol', 'Formic acid', 'Heptane', 'Hexamethylphosphoramide', 'Hexane',
  'Isopropyl alcohol', 'Isopropylacetate', 'Methanol', 'Methyl acetate', 'Methyl cyclohexane', 'Methyl ethyl ketone',
  'Methyl isobutyl ketone', 'Methyl tert-butyl ether', 'Methyl tetrahydrofuran', 'N,N-Dimethylacetamide',
  'N,N-Dimethylformamide', 'N-Methyl-2-pyrrolidinone', 'Nitromethane', 'Pentane', 'Pyridine', 'Sulfolane',
  'Tetrahydrofuran', 'Toluene', 'Triethylamine', 'Water', 'Xylenes', 'n-Butanol', 'n-Butylacetate', 't-Butanol',
] as const

interface BaseScopedToolCall { id: string }

interface ChemicalToolCall extends BaseScopedToolCall {
  name: 'lookup_chem21_solvent' | 'lookup_pubchem_profile' | 'calculate_rdkit_properties'
  chemical: string
}

interface EvidenceToolCall extends BaseScopedToolCall {
  name: 'lookup_experimental_solvent_evidence'
  mode: EvidenceMode
  solvent: string
  temperatureK: number
  solute?: string
  coSolvent?: string
  fractionSolvent?: number
  fractionType?: string
  canonicalSoluteSmiles?: string
}

interface HazardToolCall extends BaseScopedToolCall {
  name: 'lookup_solvent_hazard_profile'
  solvent: string
}

interface ScreeningToolCall extends BaseScopedToolCall {
  name: 'screen_solvent_candidates'
  solute: string
  currentSolvent: string
  temperatureK: number
  canonicalSoluteSmiles?: string
}

export interface LiteratureEvidenceToolCall extends BaseScopedToolCall {
  name: 'search_scoped_literature_evidence'
  query: string
  signalGroups?: EvidenceSignalGroup[]
}

export type ScopedToolCall = ChemicalToolCall | EvidenceToolCall | HazardToolCall | ScreeningToolCall | LiteratureEvidenceToolCall

export interface ToolResult {
  operation: 'chem21' | 'pubchem' | 'rdkit' | 'solvent_evidence' | 'solvent_hazard' | 'solvent_screening' | 'literature_evidence'
  chemical_name: string
  status: 'ok' | 'not_found' | 'unavailable'
  source: string
  data: Record<string, unknown>
  citations: Citation[]
  warnings: string[]
}

export interface LiteratureEvidenceToolResult extends ToolResult {
  operation: 'literature_evidence'
  data: { evidence: LiteratureEvidenceMatch[] }
}

type ToolParameter =
  | { type: 'string'; enum?: readonly string[] }
  | { type: 'number'; enum?: readonly string[] }
  | { type: 'array'; enum?: readonly string[]; items: { type: 'string'; enum: readonly string[] } }

interface ToolSchemaVariant {
  properties: Record<string, ToolParameter>
  required: string[]
}

export interface ChatToolDefinition {
  type: 'function'
  function: {
    name: ToolName
    description: string
    parameters: {
      type: 'object'
      additionalProperties: false
      properties: Record<string, ToolParameter>
      required: string[]
      oneOf?: ToolSchemaVariant[]
    }
  }
}

export function scopedChemicals(context: TalkAboutContext): string[] {
  return [...new Set([
    ...context.steps.flatMap(step => step.chemicals.map(chemical => chemical.name.trim())),
    ...context.recommendations.flatMap(recommendation => [
      recommendation.original.chemical.trim(),
      recommendation.alternative.chemical.trim(),
    ]),
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right))
}

function parameters(properties: Record<string, ToolParameter>, required: string[], oneOf?: ToolSchemaVariant[]) {
  return {
    type: 'object' as const,
    additionalProperties: false as const,
    properties,
    required,
    ...(oneOf ? { oneOf } : {}),
  }
}

export function buildChatTools(context: TalkAboutContext): ChatToolDefinition[] {
  const scoped = scopedChemicals(context)
  const scopedChemical = { type: 'string' as const, enum: scoped }
  const localSolvent = { type: 'string' as const, enum: LOCAL_INDEXED_SOLVENTS }

  return [
    { type: 'function', function: {
      name: 'lookup_chem21_solvent',
      description: 'Look up a scoped or locally indexed solvent in the local CHEM21 selection guide.',
      parameters: parameters({ chemical: { type: 'string', enum: [...scoped, ...LOCAL_INDEXED_SOLVENTS] } }, ['chemical']),
    } },
    { type: 'function', function: {
      name: 'lookup_pubchem_profile', description: 'Look up a scoped chemical’s PubChem properties and GHS profile.',
      parameters: parameters({ chemical: scopedChemical }, ['chemical']),
    } },
    { type: 'function', function: {
      name: 'calculate_rdkit_properties', description: 'Calculate RDKit properties for a scoped, resolved chemical.',
      parameters: parameters({ chemical: scopedChemical }, ['chemical']),
    } },
    { type: 'function', function: {
      name: 'lookup_experimental_solvent_evidence',
      description: 'Read local experimental solvent measurements for scoped chemicals or a local indexed solvent density.',
      parameters: parameters({
        mode: { type: 'string', enum: ['single_solubility', 'mixture_solubility', 'density'] },
        solute: scopedChemical,
        solvent: { type: 'string', enum: [...scoped, ...LOCAL_INDEXED_SOLVENTS] },
        coSolvent: scopedChemical,
        fractionSolvent: { type: 'number' },
        fractionType: { type: 'string' },
        temperatureK: { type: 'number' },
      }, ['mode', 'solvent', 'temperatureK'], [
        { properties: { mode: { type: 'string', enum: ['density'] }, solvent: localSolvent }, required: ['mode', 'solvent', 'temperatureK'] },
        { properties: { mode: { type: 'string', enum: ['single_solubility'] }, solute: scopedChemical, solvent: scopedChemical }, required: ['mode', 'solute', 'solvent', 'temperatureK'] },
        { properties: { mode: { type: 'string', enum: ['mixture_solubility'] }, solute: scopedChemical, solvent: scopedChemical, coSolvent: scopedChemical, fractionSolvent: { type: 'number' }, fractionType: { type: 'string' } }, required: ['mode', 'solute', 'solvent', 'coSolvent', 'fractionSolvent', 'fractionType', 'temperatureK'] },
      ]),
    } },
    { type: 'function', function: {
      name: 'lookup_solvent_hazard_profile', description: 'Read the local GHS hazard profile for a locally indexed solvent.',
      parameters: parameters({ solvent: localSolvent }, ['solvent']),
    } },
    { type: 'function', function: {
      name: 'screen_solvent_candidates', description: 'Screen local solvent candidates against a scoped solute and current solvent at an exact temperature.',
      parameters: parameters({ solute: scopedChemical, currentSolvent: scopedChemical, temperatureK: { type: 'number' } }, ['solute', 'currentSolvent', 'temperatureK']),
    } },
    { type: 'function', function: {
      name: 'search_scoped_literature_evidence', description: 'Search the bounded, page-level literature evidence index for the frozen discussion scope.',
      parameters: parameters({
        query: { type: 'string' },
        signalGroups: { type: 'array', items: { type: 'string', enum: ['comparison', 'process', 'outcome', 'hazard'] } },
      }, ['query']),
    } },
  ]
}

function matches(values: readonly string[], value: string): boolean {
  return values.some(item => item.toLowerCase() === value.toLowerCase())
}

function queryMatchesScope(context: TalkAboutContext, query: string): boolean {
  const normalizedQuery = query.toLocaleLowerCase()
  if (scopedChemicals(context).some(chemical => normalizedQuery.includes(chemical.toLocaleLowerCase()))) return true
  return context.recommendations.some(recommendation => (
    normalizedQuery.includes(recommendation.original.chemical.toLocaleLowerCase())
      && normalizedQuery.includes(recommendation.alternative.chemical.toLocaleLowerCase())
  ))
}

function assertFiniteTemperature(temperatureK: number): void {
  if (!Number.isFinite(temperatureK)) throw new Error('Tool request requires a finite temperatureK')
}

function requestFor(call: Exclude<ScopedToolCall, LiteratureEvidenceToolCall>): Record<string, unknown> {
  switch (call.name) {
    case 'lookup_chem21_solvent': return { operation: 'chem21', chemical_name: call.chemical }
    case 'lookup_pubchem_profile': return { operation: 'pubchem', chemical_name: call.chemical }
    case 'calculate_rdkit_properties': return { operation: 'rdkit', chemical_name: call.chemical }
    case 'lookup_solvent_hazard_profile': return { operation: 'solvent_hazard', solvent: call.solvent }
    case 'screen_solvent_candidates':
      if (!call.canonicalSoluteSmiles) throw new Error('Resolve the scoped solute with PubChem before screening')
      return { operation: 'solvent_screening', solute_smiles: call.canonicalSoluteSmiles, current_solvent: call.currentSolvent, temperature_k: call.temperatureK }
    case 'lookup_experimental_solvent_evidence': {
      const request: Record<string, unknown> = { operation: 'solvent_evidence', mode: call.mode, solvent: call.solvent, temperature_k: call.temperatureK }
      if (call.mode !== 'density') {
        if (!call.canonicalSoluteSmiles) throw new Error('Resolve the scoped solute with PubChem before looking up solubility')
        request.solute_smiles = call.canonicalSoluteSmiles
      }
      if (call.mode === 'mixture_solubility') {
        request.co_solvent = call.coSolvent
        request.fraction_solvent = call.fractionSolvent
        request.fraction_type = call.fractionType
      }
      return request
    }
  }
}

export async function executeScopedTool(context: TalkAboutContext, call: ScopedToolCall, signal?: AbortSignal): Promise<ToolResult> {
  const scoped = scopedChemicals(context)
  switch (call.name) {
    case 'lookup_chem21_solvent':
      if (!matches([...scoped, ...LOCAL_INDEXED_SOLVENTS], call.chemical)) throw new Error('Requested chemical is outside this scoped discussion')
      break
    case 'lookup_pubchem_profile':
    case 'calculate_rdkit_properties':
      if (!matches(scoped, call.chemical)) throw new Error('Requested chemical is outside this scoped discussion')
      break
    case 'lookup_solvent_hazard_profile':
      if (!matches(LOCAL_INDEXED_SOLVENTS, call.solvent)) throw new Error('Requested solvent is outside this scoped discussion')
      break
    case 'screen_solvent_candidates':
      if (!matches(scoped, call.solute) || !matches(scoped, call.currentSolvent)) throw new Error('Requested chemical is outside this scoped discussion')
      assertFiniteTemperature(call.temperatureK)
      break
    case 'lookup_experimental_solvent_evidence':
      assertFiniteTemperature(call.temperatureK)
      if (call.mode === 'density') {
        if (!matches(LOCAL_INDEXED_SOLVENTS, call.solvent)) throw new Error('Requested solvent is outside this scoped discussion')
      } else if (!call.solute || !matches(scoped, call.solute) || !matches(scoped, call.solvent) || (call.mode === 'mixture_solubility' && (!call.coSolvent || !matches(scoped, call.coSolvent)))) {
        throw new Error('Requested chemical is outside this scoped discussion')
      }
      break
    case 'search_scoped_literature_evidence': {
      if (!queryMatchesScope(context, call.query)) throw new Error('Literature evidence query must mention a scoped chemical or recommendation pair')
      const evidence = await searchLiteratureEvidence({ query: call.query, limit: 5, threshold: 0.25, signalGroups: call.signalGroups, signal })
      return {
        operation: 'literature_evidence', chemical_name: '', status: 'ok', source: 'Literature evidence index',
        data: { evidence }, citations: evidence.map(citationFromEvidenceMatch), warnings: [],
      }
    }
  }

  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (process.env.CHEMISTRY_SERVICE_TOKEN) headers.set('X-Chemistry-Service-Token', process.env.CHEMISTRY_SERVICE_TOKEN)
  const response = await fetch(`${process.env.CHEMISTRY_SERVICE_URL || 'http://localhost:8000'}/assistant-tools`, {
    method: 'POST', headers, signal, body: JSON.stringify(requestFor(call)),
  })
  if (!response.ok) throw new Error(`Chemistry tool request failed (${response.status})`)
  return await response.json() as ToolResult
}
