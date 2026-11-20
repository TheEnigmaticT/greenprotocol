/**
 * The one place the plain-language summary stored in `chemistryDataStatus.message`
 * is written. The analysis pipeline and re-scoring both call it, so the two can
 * never drift apart. The UI derives its own copy from the flags, not from the stored text.
 */
export function buildChemistryStatusMessage(flags: {
  scoringAvailable: boolean
  unresolvedCount: number
  indefiniteCount: number
}): string {
  if (!flags.scoringAvailable) {
    return "We couldn't get reference data for the materials in this procedure, so it has no reference-based score. Retry scoring in a few minutes."
  }
  if (flags.unresolvedCount > 0) {
    return "Scoring finished using the reference data we could find. For the materials listed, we couldn't get reference data, so the calculations that need it leave them out."
  }
  if (flags.indefiniteCount > 0) {
    return "Scoring finished. Mixtures and materials without a fixed composition can't be scored as a single chemical, so they are left out of the calculations that need one."
  }
  return 'Reference data was found for every material in this procedure.'
}
