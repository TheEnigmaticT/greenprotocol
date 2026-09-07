/**
 * Inventory-gated hazardous chemical detection for local chemical_swap repair.
 * Keys off parsed chemical names, enrichment GHS fields, and the local CHEMICALS
 * DB — never protocol titles or protocol-specific hardcodes.
 */
import { findChemical } from '@/lib/chemicals'
import {
  isChemicalSwapRecommendation,
  stampRecommendationKinds,
} from '@/lib/recommendation-kind'
import type { EnrichedChemical, Recommendation } from '@/lib/types'

export type HazardClass =
  | 'corrosive_mineral_acid'
  | 'anhydride_acylating'
  | 'chlorinated_solvent'
  | 'hazardous_solvent'
  | 'toxic_heavy_metal_catalyst'
  | 'ghs_severe'
  | 'chem21_hazardous'

export interface InventoryChemicalRef {
  name: string
  role?: string | null
  stepNumber?: number | null
}

export interface HazardousInventoryItem {
  name: string
  classes: HazardClass[]
  signals: string[]
  stepNumber?: number
  role?: string
}

const MINERAL_ACID_RE =
  /\b(?:concentrated\s+|conc\.?\s+|glacial\s+)?(?:hydrochloric|sulfuric|sulphuric|nitric|phosphoric|hydrobromic|perchloric|hydrofluoric)\s+acid\b|\b(?:aq\.?\s*)?(?:hcl|h2so4|hno3|h3po4|hbr|hclo4)\b/i

const ANHYDRIDE_ACYL_RE =
  /\b(?:acetic|propionic|trifluoroacetic|maleic|phthalic)\s+anhydride\b|\banhydride\b|\b(?:acid|acyl)\s+chloride\b|\b(?:thionyl|oxalyl|phosphoryl|phosphorus)\s+chloride\b|\b(?:socl2|coc12|pocl3|pcl5|pcl3)\b/i

const CHLORINATED_SOLVENT_RE =
  /\b(?:dichloromethane|methylene\s+chloride|\bdcm\b|chloroform|carbon\s+tetrachloride|tetrachloromethane|1,?\s*2-?\s*dichloroethane|\bdce\b|trichloroeth(?:ylene|ene)|perchloroeth(?:ylene|ene)|chlorobenzene|1,?\s*2-?\s*dichlorobenzene)\b/i

const HAZARDOUS_SOLVENT_RE =
  /\b(?:n,?\s*n-?\s*dimethylformamide|\bdmf\b|n-?\s*methyl-?\s*2?-?\s*pyrrolidone|\bnmp\b|1,?\s*4-?\s*dioxane|\bdioxane\b|diethyl\s+ether|\bet2o\b|\bether\b|petroleum\s+ether|n-?\s*hexane|\bhexanes?\b|benzene|carbon\s+disulfide|\bcs2\b|nitromethane|acetonitrile|\bmeCN\b)\b/i

const HEAVY_METAL_CATALYST_RE =
  /\b(?:palladium|platinum|rhodium|ruthenium|osmium|iridium|mercury|cadmium|chromium|nickel|lead)\b|\b(?:pd|pt|rh|ru|os|ir|hg|cd|ni|pb)\s*\(|\b(?:pd|pt|rh|ru|os|ir)\([^)]*\)|\bcr\s*\(?\s*vi\s*\)?/i

/**
 * GHS codes that justify a substance-level greener swap opportunity.
 * Flammability alone (H224–H226) is NOT enough — ethanol / EtOAc / 2-MeTHF are
 * often recommended greener solvents yet carry H225. Flammable hazards are
 * covered via hazardous_solvent name heuristics + chem21 hazardous class.
 */
const SEVERE_GHS_RE =
  /^H(290|300|301|310|311|314|318|330|331|340|341|350|351|360|361|370|371|372|373)([A-Za-z]*)$/i

const CHEM21_HAZARD = new Set(['hazardous', 'highly_hazardous'])

function uniq(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

function extractGhsCodes(
  enriched?: EnrichedChemical | null,
  dbGhs?: string[],
): string[] {
  const codes: string[] = []
  if (enriched?.ghs_hazards) {
    for (const h of enriched.ghs_hazards) {
      if (typeof h?.code === 'string' && h.code.trim()) codes.push(h.code.trim())
    }
  }
  if (dbGhs) {
    for (const c of dbGhs) {
      if (typeof c === 'string' && c.trim()) codes.push(c.trim())
    }
  }
  return uniq(codes)
}

function classifyFromName(name: string): { classes: HazardClass[]; signals: string[] } {
  const classes: HazardClass[] = []
  const signals: string[] = []
  if (MINERAL_ACID_RE.test(name)) {
    classes.push('corrosive_mineral_acid')
    signals.push('name:mineral_acid')
  }
  if (ANHYDRIDE_ACYL_RE.test(name)) {
    classes.push('anhydride_acylating')
    signals.push('name:anhydride_acylating')
  }
  if (CHLORINATED_SOLVENT_RE.test(name)) {
    classes.push('chlorinated_solvent')
    signals.push('name:chlorinated_solvent')
  }
  if (HAZARDOUS_SOLVENT_RE.test(name)) {
    classes.push('hazardous_solvent')
    signals.push('name:hazardous_solvent')
  }
  if (HEAVY_METAL_CATALYST_RE.test(name)) {
    classes.push('toxic_heavy_metal_catalyst')
    signals.push('name:heavy_metal_catalyst')
  }
  return { classes, signals }
}

/**
 * Classify one inventory chemical using enrichment + local DB + name heuristics.
 * Does not use protocol title.
 */
export function classifyInventoryChemical(
  chem: InventoryChemicalRef,
  enriched?: EnrichedChemical | null,
): HazardousInventoryItem | null {
  const name = (chem.name || '').trim()
  if (!name) return null

  const classes: HazardClass[] = []
  const signals: string[] = []

  const fromName = classifyFromName(name)
  classes.push(...fromName.classes)
  signals.push(...fromName.signals)

  const db = findChemical(name)
  const ghsCodes = extractGhsCodes(enriched, db?.ghsHazards)

  if (db) {
    if (CHEM21_HAZARD.has(db.chem21Class)) {
      classes.push('chem21_hazardous')
      signals.push(`chem21:${db.chem21Class}`)
    }
    if (db.isHazardousWaste) signals.push('db:hazardous_waste')
    if (db.isSuspectedCarcinogen) {
      if (!classes.includes('ghs_severe')) classes.push('ghs_severe')
      signals.push('db:suspected_carcinogen')
    }
    // Mineral acids / corrosives in DB often chem21=problematic but H314/H290.
    if (/\bacid\b/i.test(db.name) && ghsCodes.some((c) => /^H(290|314)$/i.test(c))) {
      if (!classes.includes('corrosive_mineral_acid')) {
        classes.push('corrosive_mineral_acid')
        signals.push('db:corrosive_acid')
      }
    }
    if (/\banhydride\b/i.test(db.name) && !classes.includes('anhydride_acylating')) {
      classes.push('anhydride_acylating')
      signals.push('db:anhydride')
    }
  }

  const severeGhs = ghsCodes.filter((c) => SEVERE_GHS_RE.test(c))
  if (severeGhs.length > 0) {
    if (!classes.includes('ghs_severe')) classes.push('ghs_severe')
    signals.push(`ghs:${severeGhs.slice(0, 6).join(',')}`)
  }

  // CHEM21-recommended solvents (ethanol, EtOAc, 2-MeTHF, …) must not trip the
  // gate from generic residual signals — require a concrete hazard class or
  // non-recommended chem21 / name heuristic already recorded above.
  if (db?.chem21Class === 'recommended') {
    const allowed = new Set<HazardClass>([
      'corrosive_mineral_acid',
      'anhydride_acylating',
      'chlorinated_solvent',
      'hazardous_solvent',
      'toxic_heavy_metal_catalyst',
      'chem21_hazardous',
    ])
    const kept = classes.filter((c) => allowed.has(c) || (c === 'ghs_severe' && severeGhs.some((code) => !/^H22[4-6]/i.test(code))))
    classes.length = 0
    classes.push(...kept)
  }

  if (classes.length === 0) return null

  const uniqueClasses = Array.from(new Set(classes))
  return {
    name,
    classes: uniqueClasses,
    signals: uniq(signals),
    stepNumber: chem.stepNumber ?? undefined,
    role: chem.role ?? undefined,
  }
}

function matchEnriched(
  name: string,
  enrichedChemicals?: EnrichedChemical[] | null,
): EnrichedChemical | undefined {
  if (!enrichedChemicals?.length) return undefined
  const lower = name.toLowerCase()
  return enrichedChemicals.find(
    (e) =>
      e.name.toLowerCase() === lower ||
      lower.includes(e.name.toLowerCase()) ||
      e.name.toLowerCase().includes(lower),
  )
}

/** Scan protocol inventory (+ optional enrichment) for hazardous substance classes. */
export function collectHazardousInventory(
  chemicals: InventoryChemicalRef[],
  enrichedChemicals?: EnrichedChemical[] | null,
): HazardousInventoryItem[] {
  const byName = new Map<string, HazardousInventoryItem>()
  for (const chem of chemicals) {
    const enriched = matchEnriched(chem.name, enrichedChemicals)
    const item = classifyInventoryChemical(chem, enriched)
    if (!item) continue
    const key = item.name.toLowerCase()
    const existing = byName.get(key)
    if (!existing) {
      byName.set(key, item)
      continue
    }
    existing.classes = Array.from(new Set([...existing.classes, ...item.classes]))
    existing.signals = uniq([...existing.signals, ...item.signals])
    if (existing.stepNumber == null && item.stepNumber != null) {
      existing.stepNumber = item.stepNumber
    }
  }
  return Array.from(byName.values())
}

export function countChemicalSwaps(recommendations: Recommendation[]): number {
  return stampRecommendationKinds(recommendations).filter(isChemicalSwapRecommendation)
    .length
}

export interface SwapRepairGateInput {
  recommendations: Recommendation[]
  hazardousInventory: HazardousInventoryItem[]
}

/**
 * Fire repair only when inventory still has hazardous classes AND stamped
 * recommendations contain zero chemical_swap tips.
 */
export function shouldRepairChemicalSwaps(input: SwapRepairGateInput): boolean {
  if (!input.hazardousInventory.length) return false
  return countChemicalSwaps(input.recommendations) === 0
}

/** Flatten analysis steps into inventory refs for hazard scanning. */
export function inventoryRefsFromSteps(
  steps: Array<{
    stepNumber: number
    chemicals: Array<{ name: string; role?: string | null }>
  }>,
): InventoryChemicalRef[] {
  const refs: InventoryChemicalRef[] = []
  for (const step of steps) {
    for (const chem of step.chemicals) {
      refs.push({
        name: chem.name,
        role: chem.role,
        stepNumber: step.stepNumber,
      })
    }
  }
  return refs
}
