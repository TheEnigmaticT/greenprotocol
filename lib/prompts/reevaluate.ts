import { Recommendation } from '@/lib/types'
import { SearchResult } from '@/lib/vector-search'

/**
 * Phase 2.7: Re-evaluation System Prompt
 * 
 * After generating recommendations and retrieving literature evidence,
 * re-evaluate each recommendation based on the actual evidence found.
 * The LLM can confirm, downgrade confidence, adjust rationale, or suppress
 * a recommendation if the evidence contradicts the original suggestion.
 */

export function buildReevaluatePrompt(
  recommendation: Recommendation,
  literatureEvidence: SearchResult[]
): string {
  const hasEvidence = literatureEvidence.length > 0
  const citationContext = hasEvidence
    ? literatureEvidence.map((lit, idx) => 
        `[${idx + 1}] ${lit.title} (${lit.authors || 'Unknown'}, ${lit.year || 'n.d.'})\n` +
        `   Journal: ${lit.journal || 'N/A'}\n` +
        `   Snippet: ${lit.content_snippet || 'No content available'}\n` +
        `   Similarity: ${(lit.similarity * 100).toFixed(1)}%`
      ).join('\n\n')
    : 'No relevant literature evidence was found in the vector database.'

  return `You are a green chemistry expert conducting a critical re-evaluation of a recommendation.

# Original Recommendation

**Step:** ${recommendation.stepNumber}
**Original Chemical:** ${recommendation.original.chemical}
**Issue:** ${recommendation.original.issue}

**Proposed Alternative:** ${recommendation.alternative.chemical}
**Rationale:** ${recommendation.alternative.rationale}

**Initial Severity:** ${recommendation.severity}
**Initial Confidence:** ${recommendation.confidenceLevel}
**Principles Violated:** ${recommendation.principleNumbers.join(', ')} (${recommendation.principleNames.join(', ')})

# Retrieved Literature Evidence

${citationContext}

# Your Task

Re-evaluate this recommendation based on the retrieved literature evidence. You must:

1. **Assess Evidence Quality:** Does the retrieved literature actually support the proposed substitution?
   - Does it mention both the original chemical and the alternative?
   - Is the chemistry context similar (organic synthesis, catalysis, etc.)?
   - Are the green chemistry benefits substantiated?

2. **Confirm, Adjust, or Suppress:**
   - **CONFIRM:** If evidence strongly supports the recommendation, keep it as-is or upgrade confidence
   - **DOWNGRADE:** If evidence is weak, contradictory, or context-mismatched, lower confidence and flag concerns
   - **SUPPRESS:** If evidence directly contradicts the recommendation or shows the alternative is worse, mark for suppression

3. **Revise Rationale:** Update the rationale to reflect what the literature actually says, not what was assumed

4. **Document Concerns:** If the evidence doesn't support the recommendation, be explicit about why

## Rules

- Be conservative: suppress or downgrade if evidence is insufficient or contradictory
- Don't fabricate support: if the literature doesn't mention the alternative, say so
- Context matters: a valid substitution in one chemistry domain may not apply to another
- Quantitative evidence (yields, selectivity, scale) beats qualitative claims
- If no literature was found, **downgrade confidence** and flag as "needs experimental validation"

Return your re-evaluation as structured JSON.`
}

export const REEVALUATE_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['confirm', 'downgrade', 'suppress'],
      description: 'What to do with this recommendation based on evidence'
    },
    revisedConfidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: 'Confidence level after re-evaluation'
    },
    revisedSeverity: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: 'Severity level after re-evaluation (if changed)'
    },
    revisedRationale: {
      type: 'string',
      description: 'Updated rationale reflecting what the literature actually supports'
    },
    evidenceAssessment: {
      type: 'object',
      properties: {
        supportsOriginalIssue: {
          type: 'boolean',
          description: 'Does literature confirm the original chemical is problematic?'
        },
        supportsAlternative: {
          type: 'boolean',
          description: 'Does literature support the proposed alternative?'
        },
        contextMatch: {
          type: 'string',
          enum: ['strong', 'partial', 'weak', 'none'],
          description: 'How well does the literature context match this protocol?'
        },
        quantitativeData: {
          type: 'boolean',
          description: 'Does the literature provide quantitative comparison data?'
        }
      },
      required: ['supportsOriginalIssue', 'supportsAlternative', 'contextMatch', 'quantitativeData']
    },
    concerns: {
      type: 'array',
      items: { type: 'string' },
      description: 'Specific concerns or caveats discovered during re-evaluation'
    },
    suppressionReason: {
      type: 'string',
      description: 'Required if action=suppress: why this recommendation should not be shown'
    }
  },
  required: ['action', 'revisedConfidence', 'revisedRationale', 'evidenceAssessment', 'concerns']
} as const
