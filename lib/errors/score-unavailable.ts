const REASONS: Array<[RegExp, string]> = [
  [/yield|pmi|benchmark/i, 'Needs a reported yield or a recognizable reaction type. Add the yield or product amount to the procedure to score this.'],
  [/smiles|reaction equation|rdkit/i, "Needs a clear reaction with its reactants and products, and we couldn't work one out from this procedure."],
  [/chem21|solvent/i, "The solvent guide data wasn't available this time. Retry scoring."],
  [/no steps/i, 'No procedure steps were found to assess.'],
  [/llm|classif|parse|assessment|protocol text|no response/i, "The automated assessment for this principle didn't finish. Retry scoring."],
]

/**
 * Plain-language reason a principle has no score. The scoring service's own
 * message is only matched against, never shown, because it names libraries and
 * internal steps.
 */
export function describeUnavailableScore(details: Record<string, unknown> | undefined): string {
  const raw = typeof details?.error === 'string' ? details.error : ''
  for (const [pattern, reason] of REASONS) {
    if (pattern.test(raw)) return reason
  }
  return "We didn't have enough information to score this principle."
}
