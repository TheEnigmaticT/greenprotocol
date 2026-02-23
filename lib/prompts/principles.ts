import { AnalysisStep } from '@/lib/types'
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
export function buildChemicalContext(steps: AnalysisStep[]): string {
  const seen = new Set<string>()
  const entries: string[] = []

  for (const step of steps) {
    for (const chem of step.chemicals) {
      const key = chem.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      const data = findChemical(chem.name)
      if (!data) {
        entries.push(`- ${chem.name}: Not in our database. Use your chemistry knowledge.`)
        continue
      }

      const parts = [
        `- ${data.name} (CAS: ${data.cas})`,
        `  CHEM21 class: ${data.chem21Class}`,
        `  GHS hazards: ${data.ghsHazards.join(', ') || 'none listed'}`,
        `  Carcinogen: ${data.isSuspectedCarcinogen ? 'YES (suspected)' : 'No'}`,
        `  Hazardous waste: ${data.isHazardousWaste ? 'YES' : 'No'}`,
        `  Environmental impact: CO2e ${data.co2ePerKg} kg/kg, Water ${data.waterPerKg} L/kg, Energy ${data.energyPerKg} kWh/kg`,
      ]

      if (data.greenAlternatives.length > 0) {
        parts.push(`  Known green alternatives:`)
        for (const alt of data.greenAlternatives) {
          parts.push(`    → ${alt.chemical} (${alt.context}; yield: ${alt.yieldImpact}; source: ${alt.source})`)
        }
      }

      entries.push(parts.join('\n'))
    }
  }

  if (entries.length === 0) return 'No chemicals found in our database for this protocol.'
  return entries.join('\n\n')
}

/**
 * Build the full system prompt for a principle evaluation agent.
 */
export function buildPrinciplePrompt(principle: PrincipleDefinition, steps: AnalysisStep[]): string {
  const chemContext = buildChemicalContext(steps)

  return `You are a green chemistry expert specializing in Principle ${principle.number}: ${principle.name}.

PRINCIPLE DEFINITION:
${principle.description}

WHAT TO LOOK FOR:
${principle.lookFor}

CHEMICAL DATABASE (from our verified database — use this data when available):
${chemContext}

INSTRUCTIONS:
- Analyze the provided protocol steps against Principle ${principle.number} ONLY.
- Return 0 or more recommendations. If this principle is not violated, return an empty recommendations array.
- Be CONSERVATIVE — only recommend alternatives with published evidence or well-established precedent.
- Do NOT hallucinate citations — say "published studies" or "CHEM21 solvent guide" if referencing general knowledge.
- Use chemical names from our database when referring to alternatives listed above.

Return ONLY valid JSON (no markdown fences, no extra text):

{
  "principleNumber": ${principle.number},
  "recommendations": [
    {
      "stepNumber": 1,
      "principleNumbers": [${principle.number}],
      "principleNames": ["${principle.name}"],
      "severity": "high|medium|low",
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
      "confidenceLevel": "high|medium|low"
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
