import type { TalkAboutContext } from '@/lib/talk-about-this/context'

export const TOOL_NAMES = [
  'lookup_chem21_solvent',
  'lookup_pubchem_profile',
  'calculate_rdkit_properties',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

export interface ChatToolDefinition {
  type: 'function'
  function: {
    name: ToolName
    description: string
    parameters: {
      type: 'object'
      additionalProperties: false
      properties: {
        chemical: { type: 'string'; enum: string[] }
      }
      required: ['chemical']
    }
  }
}

function scopedChemicals(context: TalkAboutContext): string[] {
  return [...new Set([
    ...context.steps.flatMap(step => step.chemicals.map(chemical => chemical.name.trim())),
    ...context.recommendations.flatMap(recommendation => [
      recommendation.original.chemical.trim(),
      recommendation.alternative.chemical.trim(),
    ]),
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right))
}

export function buildChatTools(context: TalkAboutContext): ChatToolDefinition[] {
  const chemical = { type: 'string' as const, enum: scopedChemicals(context) }
  const parameters = {
    type: 'object' as const,
    additionalProperties: false as const,
    properties: { chemical },
    required: ['chemical'] as ['chemical'],
  }

  return [
    { type: 'function', function: { name: 'lookup_chem21_solvent', description: 'Look up a scoped solvent in the local CHEM21 selection guide.', parameters } },
    { type: 'function', function: { name: 'lookup_pubchem_profile', description: 'Look up a scoped chemical’s PubChem properties and GHS profile.', parameters } },
    { type: 'function', function: { name: 'calculate_rdkit_properties', description: 'Calculate RDKit properties for a scoped, resolved chemical.', parameters } },
  ]
}
