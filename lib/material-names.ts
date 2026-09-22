import type { AnalysisStep, ParsedChemical } from '@/lib/types'

/**
 * Parser labels pick up procedure adjectives and lab shorthand.
 * Clean those before identity lookup so "conc. HCl" and "cold distilled water"
 * are the chemicals they are. This is not a reaction-specific rewrite.
 */

const LEADING_MODIFIER =
  /^(?:(?:ice-cold|ice cold|cold|hot|warm|distilled|deionized|deionised|concentrated|conc\.?|aqueous|aq\.?|glacial|anhydrous|saturated|sat\.?|fresh|minimal volume of)\s+)+/i

const TRAILING_FORM = /\s+(?:aqueous\s+)?(?:solutions?|mixtures?|soln\.?)\s*$/i

const ALIASES: Record<string, string> = {
  hcl: 'hydrochloric acid',
  h2so4: 'sulfuric acid',
  hno3: 'nitric acid',
  hno2: 'nitrous acid',
  naoh: 'sodium hydroxide',
  koh: 'potassium hydroxide',
  nano2: 'sodium nitrite',
  etoh: 'ethanol',
  meoh: 'methanol',
  dcm: 'dichloromethane',
  etoac: 'ethyl acetate',
  acoh: 'acetic acid',
}

function fold(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/₂/g, '2')
    .replace(/₃/g, '3')
    .replace(/₄/g, '4')
}

export function cleanChemicalName(raw: string): string {
  let name = fold(raw)
  if (/^dry ice$/i.test(name)) return 'dry ice'
  let previous = ''
  while (name && name !== previous) {
    previous = name
    name = name.replace(LEADING_MODIFIER, '').trim()
    name = name.replace(TRAILING_FORM, '').trim()
  }
  name = name.replace(/\s*\((?:aq|conc\.?|concentrated|glacial|cold|hot|warm|anhydrous)\)\s*$/i, '').trim()
  name = name.replace(/\s+glacial\s*$/i, '').trim()
  if (/^dry\s+/i.test(name) && !/^dry ice$/i.test(fold(raw))) {
    name = name.replace(/^dry\s+/i, '').trim()
  }
  // Parser sometimes glues catalyst trade names together.
  if (/^jacobsencatalyst$/i.test(name.replace(/\s+/g, ''))) {
    return 'Jacobsen catalyst'
  }
  const key = name.toLowerCase().replace(/\./g, '').replace(/\s+/g, '')
  return ALIASES[key] ?? name
}

export function isTestMaterial(name: string): boolean {
  return /(?:starch[- ]iodide|litmus|indicator|test)\s+paper|\btest strip\b/i.test(name)
}

/** A class name, not one compound. Brine-style: keep it and say we cannot identify it. */
export function isUnidentifiedClass(name: string): boolean {
  const key = name.toLowerCase()
  if (!/\bdiazonium\b/.test(key)) return false
  return !/\b(chloride|bromide|iodide|tetrafluoroborate|tosylate|benzene|phenyl|aryl|arene)\b/.test(key)
}

export function isGenericProductPhrase(name: string, role: string): boolean {
  if (isUnidentifiedClass(name)) return false
  if (role.trim().toLowerCase() !== 'product') return false
  const hasContainer = /\b(solution|mixture|slurry|filtrate|precipitate)\b/i.test(name)
  const isSpecific = /\b(acid|chloride|bromide|iodide|sulfate|sulphate|nitrate|oxide|hydroxide)\b/i.test(name)
  return hasContainer && !isSpecific
}

function splitMixture(chemical: ParsedChemical): ParsedChemical[] {
  const name = chemical.name
  if (/[0-9:]/.test(name)) return [chemical]
  // Keep stereo labels intact: L-(+)-tartaric acid is not a mixture.
  if (/\([+\-±]\)/.test(name)) return [chemical]
  // Split only on slash or a spaced plus, never on the + inside (+).
  const parts = name.split(/\s*\/\s*|\s+\+\s+/).map(part => part.trim()).filter(Boolean)
  if (parts.length < 2 || parts.length > 3) return [chemical]
  if (parts.some(part => part.length < 2 || part.length > 40)) return [chemical]
  return parts.map((part, index) => ({
    ...chemical,
    name: cleanChemicalName(part),
    quantity: index === 0 ? chemical.quantity : '',
    role: index === 0 ? chemical.role : 'reagent',
  }))
}

export function normalizeParsedMaterials(steps: AnalysisStep[]): AnalysisStep[] {
  return steps.map(step => ({
    ...step,
    chemicals: step.chemicals.flatMap(chemical => {
      if (isTestMaterial(chemical.name)) return []
      if (isGenericProductPhrase(chemical.name, chemical.role)) return []
      const cleaned = { ...chemical, name: cleanChemicalName(chemical.name) }
      return splitMixture(cleaned).filter(item =>
        item.name
        && !isTestMaterial(item.name)
        && !isGenericProductPhrase(item.name, item.role),
      )
    }),
  }))
}
