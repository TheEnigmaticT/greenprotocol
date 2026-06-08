import { SdsReference } from '@/lib/types'

/**
 * Build authoritative Safety Data Sheet reference links for a chemical.
 *
 * Source-priority note (see also BACKLOG "Evidence: SDS-aware waste"):
 *   1. Normalized structured hazard data (GHS / PubChem) drives ALL scoring.
 *   2. SDS references are supporting evidence and workflow (handling/disposal)
 *      context only — never a scoring input.
 *
 * This is a link layer, not a crawler: we deep-link to authoritative SDS /
 * safety sources by chemical name. No SDS text is fetched, parsed, or trusted
 * for scoring. `sdsNotes` (extracted handling/disposal text) is left for a
 * later slice once a vetted extraction path exists.
 */
export function buildSdsReferences(chemicalName: string): SdsReference[] {
  const name = chemicalName?.trim()
  if (!name) return []
  const q = encodeURIComponent(name)

  return [
    {
      // NIH PubChem aggregates GHS classifications and links primary SDS.
      supplier: 'PubChem (NIH)',
      url: `https://pubchem.ncbi.nlm.nih.gov/#query=${q}`,
    },
    {
      // Vendor SDS document search (supplier SDS for handling/disposal).
      supplier: 'Sigma-Aldrich',
      url: `https://www.sigmaaldrich.com/US/en/search/${q}?focus=documents&type=document`,
    },
  ]
}
