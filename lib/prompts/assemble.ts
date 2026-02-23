import { AnalysisStep, Recommendation } from '@/lib/types'

/**
 * Build the system prompt for the assembly phase.
 * Takes the original protocol, parsed steps, and all recommendations
 * and produces the revised protocol text + overall assessment.
 */
export function buildAssemblePrompt(
  originalProtocol: string,
  steps: AnalysisStep[],
  recommendations: Recommendation[]
): string {
  const recsJson = JSON.stringify(recommendations, null, 2)
  const stepsJson = JSON.stringify(steps, null, 2)

  return `You are a green chemistry protocol writer. You have been given:
1. An original laboratory protocol
2. The parsed steps
3. A set of green chemistry recommendations (substitutions)

Your job is to:
1. Write a REVISED version of the original protocol that incorporates ALL the recommended substitutions
2. Provide an overall assessment

ORIGINAL PROTOCOL:
${originalProtocol}

PARSED STEPS:
${stepsJson}

RECOMMENDATIONS TO INCORPORATE:
${recsJson}

INSTRUCTIONS:
- Write the revised protocol as a complete, usable laboratory procedure
- Substitute every recommended chemical replacement into the revised text
- Keep the same step structure and numbering as the original
- Adjust quantities, conditions, or procedures as needed for the substitutions
- Do NOT add recommendations beyond what is listed above — just incorporate the given ones
- Identify which green chemistry principles were violated (from the recommendations)
- Pick the single most impactful change

Return ONLY valid JSON (no markdown fences, no extra text):

{
  "revisedProtocol": "The full revised protocol text with all green alternatives substituted in, written as a complete procedure",
  "overallAssessment": {
    "greenPrinciplesViolated": [5, 3, 1],
    "mostImpactfulChange": "Brief description of the single most impactful change",
    "experimentalValidationNeeded": true,
    "disclaimer": "These recommendations are based on published literature and established green chemistry principles. Experimental validation is required before adopting any changes. Yields, selectivity, and purity may be affected."
  }
}

IMPORTANT: Return ONLY the JSON object.`
}
