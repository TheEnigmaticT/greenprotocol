import { AnalysisStep, EnrichedChemical } from '@/lib/types'
import { findChemical } from '@/lib/chemicals'

export interface PrincipleDefinition {
  number: number
  name: string
  description: string
  lookFor: string
}

export const PRINCIPLES: PrincipleDefinition[] = [
  {
    number: 1,
    name: 'Prevention',
    description: 'Prevent waste rather than treat or clean up waste after it has been created.',
    lookFor: 'Look for steps that generate unnecessary byproducts, excess reagents that become waste, or procedures where waste generation could be minimized through better design. Consider whether the synthesis route itself could be shorter or produce less waste overall.',
  },
  {
    number: 2,
    name: 'Atom Economy',
    description: 'Design syntheses to maximize the incorporation of all materials used in the process into the final product.',
    lookFor: 'Look for reactions with poor atom economy — where large portions of reactant atoms end up in byproducts rather than the desired product. Consider whether alternative reaction types (additions vs substitutions, catalytic vs stoichiometric) could improve atom economy.',
  },
  {
    number: 3,
    name: 'Less Hazardous Chemical Syntheses',
    description: 'Design syntheses to use and generate substances with little or no toxicity to human health and the environment.',
    lookFor: 'Look for toxic reagents, intermediates, or byproducts. Check for chemicals with GHS hazard statements indicating acute toxicity (H300-H311), carcinogenicity (H350-H351), mutagenicity (H340-H341), or reproductive toxicity (H360-H361). Suggest less toxic alternatives.',
  },
  {
    number: 4,
    name: 'Designing Safer Chemicals',
    description: 'Design chemical products to preserve efficacy while reducing toxicity.',
    lookFor: 'This principle applies more to product design than protocol analysis. However, look for cases where the target product or intermediates could be designed to be less toxic while maintaining function. Flag if the protocol produces known toxic end products.',
  },
  {
    number: 5,
    name: 'Safer Solvents and Auxiliaries',
    description: 'Minimize the use of auxiliary substances (solvents, separation agents, etc.) and use safer ones when necessary.',
    lookFor: 'This is often the highest-impact principle. Look for: hazardous solvents (DCM, chloroform, DMF, NMP, hexane, diethyl ether, benzene, carbon tetrachloride, 1,4-dioxane), excessive solvent volumes, and opportunities to use greener alternatives (water, ethanol, ethyl acetate, 2-MeTHF, CPME). Reference the CHEM21 solvent selection guide classifications.',
  },
  {
    number: 6,
    name: 'Design for Energy Efficiency',
    description: 'Minimize energy requirements. Run reactions at ambient temperature and pressure when possible.',
    lookFor: 'Look for reactions run at elevated temperatures or under pressure when ambient conditions might work. Consider whether reflux conditions, prolonged heating, or cryogenic conditions are truly necessary. Suggest microwave-assisted or flow chemistry alternatives if applicable.',
  },
  {
    number: 7,
    name: 'Use of Renewable Feedstocks',
    description: 'Use renewable raw materials and feedstocks rather than depleting ones whenever technically and economically practical.',
    lookFor: 'Look for petroleum-derived solvents and reagents that could be replaced with bio-based alternatives. Examples: bio-based ethanol, 2-MeTHF (from furfural/biomass), bio-based ethyl acetate. This principle has limited applicability for most lab-scale protocols but flag obvious cases.',
  },
  {
    number: 8,
    name: 'Reduce Derivatives',
    description: 'Avoid unnecessary derivatization (blocking groups, protection/deprotection, temporary modification) which requires additional reagents and generates waste.',
    lookFor: 'Look for protection/deprotection steps, temporary modifications, or blocking group strategies that could be avoided through better synthetic planning, use of selective reagents, or alternative reaction sequences.',
  },
  {
    number: 9,
    name: 'Catalysis',
    description: 'Use catalytic reagents (as selective as possible) rather than stoichiometric reagents.',
    lookFor: 'Look for stoichiometric reagents that could be replaced with catalytic alternatives. Examples: stoichiometric oxidants → catalytic oxidation, stoichiometric metal reagents → catalytic cross-coupling, excess base → catalytic amounts. Also evaluate catalyst loading — can it be reduced?',
  },
  {
    number: 10,
    name: 'Design for Degradation',
    description: 'Design chemical products so that at the end of their function they break down into innocuous degradation products and do not persist in the environment.',
    lookFor: 'Look for persistent chemicals (halogenated solvents, perfluorinated compounds) that do not degrade. Flag chemicals with known environmental persistence. This principle is more relevant to product design but applies to solvent and reagent selection.',
  },
  {
    number: 11,
    name: 'Real-time Analysis for Pollution Prevention',
    description: 'Develop analytical methodologies to allow real-time, in-process monitoring and control prior to the formation of hazardous substances.',
    lookFor: 'Look for opportunities to suggest inline monitoring (TLC, inline IR/Raman, pH monitoring) that could prevent overreaction, decomposition, or formation of hazardous byproducts. Flag steps where endpoint determination is vague ("until complete") and could benefit from real-time analysis.',
  },
  {
    number: 12,
    name: 'Inherently Safer Chemistry for Accident Prevention',
    description: 'Choose substances and processes to minimize the potential for chemical accidents, including releases, explosions, and fires.',
    lookFor: 'Look for flammable solvents (diethyl ether, hexane, THF), pyrophoric reagents (n-BuLi, NaH, LiAlH4), peroxide-forming ethers, and highly exothermic reactions. Suggest inherently safer alternatives and flag missing safety precautions.',
  },
]

/**
 * Build chemical context from our database for a specific principle evaluation.
 * Looks up every chemical in the parsed steps and returns relevant info.
 */
const UNAVAILABLE_ENRICHMENT_SOURCES = new Set([
  'not_found',
  'error',
  'indefinite',
  'queued',
  'terminal_not_found',
  'unavailable',
])

function findEnrichedChemical(
  name: string,
  enrichedChemicals?: EnrichedChemical[],
): EnrichedChemical | undefined {
  return enrichedChemicals?.find(
    (chemical) => chemical.name.trim().toLowerCase() === name.trim().toLowerCase(),
  )
}

function formatStaticFallback(name: string): string[] {
  const data = findChemical(name)
  if (!data) {
    return [
      '  Static fallback: unavailable (chemical is not in the local database).',
      '  Do not infer that this chemical is safe or that hazards are absent.',
    ]
  }

  const parts = [
    `  Static fallback provenance: local chemical database (${data.dataSource}); screening estimates, not hydrated evidence.`,
    `  CHEM21 class: ${data.chem21Class}`,
    `  GHS hazards: ${data.ghsHazards.join(', ') || 'none listed in static fallback; absence is not evidence of safety'}`,
    `  Carcinogen: ${data.isSuspectedCarcinogen ? 'YES (suspected)' : 'No flag in static fallback'}`,
    `  Hazardous waste: ${data.isHazardousWaste ? 'YES' : 'No flag in static fallback'}`,
    `  Environmental impact screening estimates: CO2e ${data.co2ePerKg} kg/kg, Water ${data.waterPerKg} L/kg, Energy ${data.energyPerKg} kWh/kg`,
  ]

  if (data.greenAlternatives.length > 0) {
    parts.push('  Alternative candidates from static fallback (not validated reaction substitutes):')
    for (const alt of data.greenAlternatives) {
      parts.push(`    → ${alt.chemical} (${alt.context}; yield: ${alt.yieldImpact}; source: ${alt.source})`)
    }
  }
  return parts
}

export function buildChemicalContext(
  steps: AnalysisStep[],
  enrichedChemicals?: EnrichedChemical[],
): string {
  const seen = new Set<string>()
  const entries: string[] = []

  for (const step of steps) {
    for (const chem of step.chemicals) {
      const key = chem.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      const enriched = findEnrichedChemical(chem.name, enrichedChemicals)
      const enrichmentUnavailable = enriched && (
        UNAVAILABLE_ENRICHMENT_SOURCES.has(enriched.reference_status || '') ||
        UNAVAILABLE_ENRICHMENT_SOURCES.has(enriched.data_source || '')
      )
      if (enriched && !enrichmentUnavailable) {
        const hazards = enriched.ghs_hazards || []
        const parts = [
          `- ${chem.name}`,
          `  Evidence provenance: hydrated chemistry service (${enriched.data_source || 'source unspecified'}).`,
          `  Reference status: ${enriched.reference_status || 'not returned by chemistry service (unknown)'}.`,
          `  Molecular properties: formula ${enriched.molecular_formula || 'not returned'}, SMILES ${enriched.smiles || 'not returned'}, molecular weight ${enriched.molecular_weight ?? 'not returned'} g/mol, density ${enriched.density_g_per_ml ?? 'not returned'} g/mL.`,
          hazards.length > 0
            ? `  GHS hazards: ${hazards.map((hazard) => `${hazard.code}${hazard.description ? ` (${hazard.description})` : ''}${hazard.source ? ` [${hazard.source}]` : ''}`).join(', ')}`
            : '  GHS hazard data: no statements returned by the chemistry service; absence is not evidence of safety.',
        ]
        if (enriched.green_alternatives?.length) {
          parts.push('  Green alternatives reported by hydrated evidence (candidates, not validated reaction substitutes):')
          for (const alternative of enriched.green_alternatives) {
            parts.push(`    → ${alternative.chemical} (source: ${alternative.source}; evidence: ${alternative.content})`)
          }
        }
        if (enriched.citations?.length) {
          parts.push(`  Citations: ${enriched.citations.map((citation) => {
            const handles = [
              `source_id=${citation.source_id}`,
              citation.source_name,
              citation.citation,
              citation.doi ? `doi=${citation.doi}` : '',
              citation.url ? `url=${citation.url}` : '',
            ].filter(Boolean)
            return handles.join(' | ')
          }).join('; ')}`)
          parts.push('  Citation publication dates: not returned by chemistry service (unknown).')
        }
        entries.push(parts.join('\n'))
        continue
      }

      const unavailable = enriched
        ? `Chemistry service enrichment unavailable (${enriched.reference_status || enriched.data_source || 'unknown'}).`
        : 'Hydrated chemistry evidence was not supplied for this chemical.'
      entries.push([
        `- ${chem.name}`,
        `  ${unavailable}`,
        '  Do not infer that this chemical is safe or that hazards are absent.',
        ...formatStaticFallback(chem.name),
      ].join('\n'))
    }
  }

  if (entries.length === 0) return 'No chemicals were parsed from this protocol.'
  return entries.join('\n\n')
}

export function buildPrincipleUserMessage(
  principle: PrincipleDefinition,
  steps: AnalysisStep[],
  enrichedChemicals?: EnrichedChemical[],
  predecisionEvidence?: string,
): string {
  return `Analyze these protocol steps against Principle ${principle.number}:\n\n${JSON.stringify(steps, null, 2)}\n\nCHEMISTRY EVIDENCE (hydrated evidence is preferred; static data is labeled fallback):\n${buildChemicalContext(steps, enrichedChemicals)}\n\n${predecisionEvidence ?? 'PREDECISION REACTION EVIDENCE: unavailable; do not claim reaction-specific literature support.'}`
}

/**
 * Build the full system prompt for a principle evaluation agent.
 */
export function buildPrinciplePrompt(principle: PrincipleDefinition, steps: AnalysisStep[]): string {
  void steps // Chemical context is supplied in the user message with per-run evidence provenance.
  return `You are a green chemistry expert specializing in Principle ${principle.number}: ${principle.name}.

PRINCIPLE DEFINITION:
${principle.description}

WHAT TO LOOK FOR:
${principle.lookFor}

CHEMISTRY EVIDENCE:
The user message contains chemical evidence. Prefer hydrated chemistry-service evidence when available. Static local-database data is explicitly labeled fallback and may contain screening estimates. Missing, unavailable, or empty hazard data is not evidence that a chemical is safe; do not invent values.

INSTRUCTIONS:
- Analyze the provided protocol steps against Principle ${principle.number} ONLY.
- Return 0 or more recommendations. If this principle is not violated, return an empty recommendations array.
- Be CONSERVATIVE — only recommend alternatives with published evidence or well-established precedent.
- Do NOT hallucinate citations — say "published studies" or "CHEM21 solvent guide" if referencing general knowledge.
- Use chemical names from the supplied evidence when referring to alternative candidates; do not imply a candidate is a validated reaction substitute.
- For EACH recommendation, set "kind" to one of: "chemical_swap" (replace one chemical with another), "process_change" (dose/energy/condition tip with no chemical replacement), or "analytical" (monitoring/analysis tip such as TLC, IR, HPLC, inline/real-time).
- Do NOT encode process or analytical tips as chemical substitutions. If the alternative is not a different chemical, use process_change or analytical.
- Never use "none" or "N/A" as alternative.chemical. For chemical_swap, name a concrete, different replacement substance, not "same chemical", an analytical method, or a dose/monitoring instruction. For process_change or analytical, name the actual process change or analytical method instead.
- A hazardous signal alone does not establish a supported substitution. Include a true chemical_swap only when the supplied evidence or well-established precedent supports a different base chemical in this reaction context; otherwise return no swap or a non-substitution recommendation where appropriate. Keep kind segregation: process tips stay process_change, monitoring stays analytical, true substitutions stay chemical_swap. Do not invent unsafe swaps or hardcode protocol-specific brand or trademark alternatives.
- For EACH recommendation, include a "primaryBenefit" field: a short (under 15 words) workflow-relevant reason such as "reduces toxic waste", "cuts liquid cleanup burden", "lowers direct chemical waste", or "reduces purification steps". This must be a concrete benefit, not a restatement of the principle.

Return ONLY valid JSON (no markdown fences, no extra text):

{
  "principleNumber": ${principle.number},
  "recommendations": [
    {
      "stepNumber": 1,
      "principleNumbers": [${principle.number}],
      "principleNames": ["${principle.name}"],
      "severity": "high|medium|low",
      "kind": "chemical_swap|process_change|analytical",
      "original": {
        "chemical": "Chemical name as it appears in the protocol",
        "issue": "Why this violates Principle ${principle.number}"
      },
      "alternative": {
        "chemical": "Recommended replacement",
        "rationale": "Why this is greener",
        "yieldImpact": "Expected impact on yield",
        "caveats": "Important limitations",
        "evidenceBasis": "Source of recommendation"
      },
      "confidenceLevel": "high|medium|low",
      "primaryBenefit": "Short workflow-relevant reason this swap helps"
    }
  ]
}

If Principle ${principle.number} is not violated by any step, return:
{
  "principleNumber": ${principle.number},
  "recommendations": []
}

IMPORTANT: Return ONLY the JSON object.`
}
