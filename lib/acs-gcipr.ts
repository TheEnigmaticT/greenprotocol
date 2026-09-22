/**
 * ACS GCI Pharmaceutical Roundtable cited guidance.
 *
 * Two deterministic lookups, neither of which can make a recommendation
 * application-eligible:
 * - Solvent catalog: hazard and identity facts. Functional-group Y/N flags
 *   describe what the solvent itself is, not reaction compatibility.
 * - Reagent guides (Suzuki, Buchwald-Hartwig, SNAr): citation cards only.
 *
 * Inference stays on the existing Qwen path. This module never calls a model.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AcsGciprCitationLayer,
  AnalysisStep,
  Citation,
  EnrichedChemical,
  Recommendation,
  RecommendationEvidenceAssessment,
} from '@/lib/types'

export const ACS_GCIPR_SOLVENT_TOOL_NAME = 'ACS GCI Pharmaceutical Roundtable solvent selection tool'
export const ACS_GCIPR_FRAMEWORK_CITATION =
  'Diorazio, Hose, Adlington, Org. Process Res. Dev. 2016, 20, 760-773'
export const ACS_GCIPR_FRAMEWORK_DOI = '10.1021/acs.oprd.6b00015'
export const ACS_GCIPR_FUNCTIONAL_GROUP_MEANING = 'solvent_identity_not_reaction_compatibility' as const

const FUNCTIONAL_GROUP_COLUMNS = [
  'Acid',
  'Alcohol',
  'Alkene',
  'Anhydride',
  'Amide',
  '1°Amide',
  '2°Amide',
  '3°Amide',
  'Amine',
  '1°Amine',
  '2°Amine',
  '3°Amine',
  'Heteroaromatic Amines',
  'Anilines',
  'Nitrogen Bases',
  'Aromatic',
  'Carbonate',
  'Ester',
  'Ether',
  'Ketone/Aldehyde',
  'Halogen',
  'Chloro',
  'Fluoro',
  'Hydrocarbon',
  'Nitrile',
  'Nitro',
  'Phosphorus Containing',
  'Sulfur Containing',
  'Sulfide',
  'Sulfoxide',
  'Sulfite',
  'Sulfone',
  'Urea',
  'Silicone',
  'Other',
] as const

const CAVEAT_COLUMNS = [
  ['General', 'General notes'],
  ['Environmental', 'Environmental notes'],
  ['Environmental Link', 'Environmental link'],
  ['Reactivity', 'Reactivity notes'],
  ['Reactivity Literature', 'Reactivity literature'],
] as const

export interface AcsGciprSolventRow {
  id: string
  name: string
  cas: string
  smiles: string
  safety: number | null
  health: number | null
  environment: number | null
  defaultRanking: string
  adjustedRanking: string
  ichClass: string | null
  ichLimitPpm: string | null
  avoidance: 'Y' | 'N' | null
  solventClasses: string[]
  caveats: { label: string; text: string }[]
}

export interface AcsSolventLookup {
  name?: string | null
  smiles?: string | null
  cas?: string | null
}

interface CatalogIndex {
  rows: AcsGciprSolventRow[]
  byCas: Map<string, AcsGciprSolventRow | null>
  bySmiles: Map<string, AcsGciprSolventRow | null>
  byName: Map<string, AcsGciprSolventRow | null>
}

interface ReagentGuideRecord {
  family: 'suzuki' | 'buchwald-hartwig' | 'snar'
  role: 'guide' | 'child'
  url: string
  title: string
  claim: string
  dois: string[]
}

let catalogCache: CatalogIndex | null = null
let guideCache: ReagentGuideRecord[] | null = null

function dataPath(name: string): string {
  return join(process.cwd(), 'data', 'acs-gcipr', name)
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function parseScore(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? ''
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }
    if (char !== '\r') cell += char
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter(item => item.some(value => value.trim().length > 0))
}

function nameTokens(name: string): string[] {
  const tokens = new Set<string>()
  const trimmed = name.trim()
  if (!trimmed) return []
  tokens.add(normalizeToken(trimmed))
  const brackets = [...trimmed.matchAll(/\[([^\]]+)\]/g)].map(match => match[1])
  const base = trimmed.replace(/\[[^\]]+\]/g, ' ')
  const baseToken = normalizeToken(base)
  if (baseToken) tokens.add(baseToken)
  for (const bracket of brackets) {
    const token = normalizeToken(bracket)
    if (token) tokens.add(token)
  }
  return [...tokens].filter(token => token.length >= 2)
}

function loadCatalog(): CatalogIndex {
  if (catalogCache) return catalogCache
  const table = parseCsv(readFileSync(dataPath('solvent-selection.csv'), 'utf8'))
  const header = table[0] ?? []
  const indexOf = (name: string) => header.indexOf(name)
  const rows: AcsGciprSolventRow[] = []
  for (const cells of table.slice(1)) {
    const get = (name: string) => cells[indexOf(name)] ?? ''
    const avoidanceRaw = get('Avoidance').trim().toUpperCase()
    const avoidance = avoidanceRaw === 'Y' || avoidanceRaw === 'N' ? avoidanceRaw : null
    const solventClasses = FUNCTIONAL_GROUP_COLUMNS.filter(column => get(column).trim().toUpperCase() === 'Y')
    const caveats = CAVEAT_COLUMNS.flatMap(([column, label]) => {
      const text = blankToNull(get(column))
      return text ? [{ label, text }] : []
    })
    if (avoidance === 'Y') {
      caveats.push({ label: 'Avoidance', text: 'Y' })
    }
    rows.push({
      id: get('ID').trim(),
      name: get('Name').trim(),
      cas: get('CAS').trim(),
      smiles: get('SMILES').trim(),
      safety: parseScore(get('Safety')),
      health: parseScore(get('Health')),
      environment: parseScore(get('Environment')),
      defaultRanking: get('Default ranking').trim(),
      adjustedRanking: get('Adjusted ranking').trim(),
      ichClass: blankToNull(get('ICH Class')),
      ichLimitPpm: blankToNull(get('ICH Limit')),
      avoidance,
      solventClasses: [...solventClasses],
      caveats,
    })
  }

  const byCas = uniqueIndex(rows, row => row.cas ? [normalizeToken(row.cas)] : [])
  const bySmiles = uniqueIndex(rows, row => row.smiles ? [row.smiles.trim()] : [])
  const byName = uniqueIndex(rows, row => nameTokens(row.name))
  catalogCache = { rows, byCas, bySmiles, byName }
  return catalogCache
}

function uniqueIndex(
  rows: AcsGciprSolventRow[],
  tokensFor: (row: AcsGciprSolventRow) => string[],
): Map<string, AcsGciprSolventRow | null> {
  const map = new Map<string, AcsGciprSolventRow | null>()
  for (const row of rows) {
    for (const token of tokensFor(row)) {
      if (!token) continue
      if (!map.has(token)) map.set(token, row)
      else if (map.get(token)?.id !== row.id) map.set(token, null)
    }
  }
  return map
}

/**
 * Conservative identity match. Ambiguous name tokens (more than one catalog
 * row) and disagreeing identifiers fail closed and return null.
 * A miss never becomes a substitution.
 */
export function lookupAcsGciprSolvent(input: AcsSolventLookup): { row: AcsGciprSolventRow; matchedOn: 'cas' | 'smiles' | 'name' } | null {
  const catalog = loadCatalog()
  const casKey = input.cas ? normalizeToken(input.cas) : null
  const smilesKey = input.smiles?.trim() ? input.smiles.trim() : null
  const nameKey = input.name ? normalizeToken(input.name) : null
  const casRow = casKey ? (catalog.byCas.has(casKey) ? catalog.byCas.get(casKey) ?? null : undefined) : undefined
  const smilesRow = smilesKey ? (catalog.bySmiles.has(smilesKey) ? catalog.bySmiles.get(smilesKey) ?? null : undefined) : undefined
  const nameRow = nameKey ? (catalog.byName.has(nameKey) ? catalog.byName.get(nameKey) ?? null : undefined) : undefined

  // null means the token is known but ambiguous. Fail closed.
  if (casRow === null || smilesRow === null || nameRow === null) return null

  const resolved = [casRow, smilesRow, nameRow].filter((row): row is AcsGciprSolventRow => Boolean(row))
  if (resolved.length === 0) return null
  if (resolved.some(row => row.id !== resolved[0].id)) return null
  const matchedOn = casRow ? 'cas' : smilesRow ? 'smiles' : 'name'
  return { row: resolved[0], matchedOn }
}

export function acsSolventCitation(): Citation {
  return {
    source_id: 'ACS-GCIPR-SOLVENT-TOOL',
    source_name: ACS_GCIPR_SOLVENT_TOOL_NAME,
    citation: `${ACS_GCIPR_FRAMEWORK_CITATION}. DOI: ${ACS_GCIPR_FRAMEWORK_DOI}`,
    doi: ACS_GCIPR_FRAMEWORK_DOI,
    url: `https://doi.org/${ACS_GCIPR_FRAMEWORK_DOI}`,
  }
}

function scoreLine(row: AcsGciprSolventRow): string {
  const parts = [
    row.safety === null ? null : `Safety ${row.safety}`,
    row.health === null ? null : `Health ${row.health}`,
    row.environment === null ? null : `Environment ${row.environment}`,
  ].filter(Boolean)
  return parts.join(', ')
}

export function describeAcsSolventFacts(row: AcsGciprSolventRow): string {
  const rankings = [
    row.defaultRanking ? `default ranking ${row.defaultRanking}` : null,
    row.adjustedRanking ? `adjusted ranking ${row.adjustedRanking}` : null,
  ].filter(Boolean).join('; ')
  const classes = row.solventClasses.length > 0
    ? `Functional-group flags ${row.solventClasses.join(', ')} identify the solvent class itself, not reaction compatibility.`
    : 'No functional-group Y flags are recorded for this row.'
  const scores = scoreLine(row)
  const ich = [
    row.ichClass ? `ICH Class ${row.ichClass}` : null,
    row.ichLimitPpm ? `ICH Limit ${row.ichLimitPpm} ppm` : null,
  ].filter(Boolean).join('; ')
  const caveats = row.caveats.map(caveat => `${caveat.label}: ${caveat.text}`).join(' ')
  return [
    `${ACS_GCIPR_SOLVENT_TOOL_NAME} lists ${row.name}${rankings ? ` (${rankings})` : ''}.`,
    'Default Recommended is a catalog band, not evidence that the solvent is reaction-safe.',
    scores ? `Scores (1-10): ${scores}.` : null,
    classes,
    ich ? `${ich}.` : null,
    caveats ? `Cited caveats (blank catalog cells omitted): ${caveats}` : null,
    `Framework paper: ${ACS_GCIPR_FRAMEWORK_CITATION}. DOI ${ACS_GCIPR_FRAMEWORK_DOI}.`,
  ].filter(Boolean).join(' ')
}

function solventLayer(row: AcsGciprSolventRow, matchedOn: 'cas' | 'smiles' | 'name'): AcsGciprCitationLayer {
  return {
    source: 'solvent_catalog',
    revisesProcedure: false,
    functionalGroupMeaning: ACS_GCIPR_FUNCTIONAL_GROUP_MEANING,
    solvent: {
      catalogId: row.id,
      catalogName: row.name,
      cas: row.cas || null,
      smiles: row.smiles || null,
      matchedOn,
      safety: row.safety,
      health: row.health,
      environment: row.environment,
      defaultRanking: row.defaultRanking || null,
      adjustedRanking: row.adjustedRanking || null,
      ichClass: row.ichClass,
      ichLimitPpm: row.ichLimitPpm,
      avoidance: row.avoidance,
      solventClasses: row.solventClasses,
      caveats: row.caveats,
    },
  }
}

function insufficientCatalogAssessment(reason: string): RecommendationEvidenceAssessment {
  return {
    disposition: 'insufficient_evidence',
    directness: 'none',
    supportingReferenceCount: 0,
    applicability: 'none',
    eligibleForApplication: false,
    eligibilityReason: reason,
  }
}

function preserveAssessment(assessment: RecommendationEvidenceAssessment | undefined): RecommendationEvidenceAssessment {
  if (!assessment) {
    return insufficientCatalogAssessment(
      'ACS GCIPR solvent catalog is cited hazard/identity guidance only and is not application-eligible.',
    )
  }
  // Never let the catalog upgrade or newly grant application eligibility.
  if (assessment.disposition === 'supported_applicable' && assessment.eligibleForApplication) {
    return assessment
  }
  return {
    ...assessment,
    eligibleForApplication: false,
  }
}

function appendCitation(rec: Recommendation, citation: Citation): Citation[] {
  const existing = rec.evidence?.citations ?? []
  if (existing.some(item => item.source_id === citation.source_id || (citation.doi && item.doi === citation.doi && item.url === citation.url))) {
    return existing
  }
  return [...existing, citation]
}

function isNamedSubstitute(original: string, alternative: string): boolean {
  const alt = alternative.trim()
  if (!alt || /^ACS GCIPR/i.test(alt)) return false
  return alt.toLowerCase() !== original.trim().toLowerCase()
}

function rankingSentence(row: AcsGciprSolventRow): string {
  const scores = scoreLine(row)
  const scoreBit = scores ? ` (${scores})` : ''
  const def = row.defaultRanking
  const adj = row.adjustedRanking
  if (def && adj && def !== adj) {
    return `The ACS solvent tool's default ranking for ${row.name} is ${def}, and the adjusted ranking is ${adj}${scoreBit}.`
  }
  if (adj || def) {
    return `The ACS solvent tool rates ${row.name} ${adj || def}${scoreBit}.`
  }
  return `The ACS solvent tool lists ${row.name}${scoreBit}.`
}

export function suggestionSentence(
  original: string,
  alternative: string,
  row: AcsGciprSolventRow,
  evidenceBasis?: string,
): string {
  let source = ''
  if (evidenceBasis && /chem21/i.test(evidenceBasis)) {
    source = `CHEM21 lists ${alternative} as an alternative. `
  } else if (evidenceBasis && /catalogue/i.test(evidenceBasis)) {
    source = `A solvent catalogue lists ${alternative} as an alternative. `
  }
  return `Consider replacing ${original} with ${alternative}. ${source}${rankingSentence(row)} This is a suggestion, not proof it works in this step.`
}

export function annotateRecommendationWithAcsSolvent(recommendation: Recommendation, lookup: AcsSolventLookup): Recommendation {
  const match = lookupAcsGciprSolvent(lookup)
  if (!match) return recommendation
  const citation = acsSolventCitation()
  const assessment = preserveAssessment(recommendation.evidenceAssessment)
  const named = isNamedSubstitute(recommendation.original.chemical, recommendation.alternative.chemical)
  const keepWording = assessment.disposition === 'supported_applicable' && assessment.eligibleForApplication
  const rationale = named && !keepWording
    ? suggestionSentence(
        recommendation.original.chemical,
        recommendation.alternative.chemical,
        match.row,
        recommendation.alternative.evidenceBasis,
      )
    : recommendation.alternative.rationale
  return {
    ...recommendation,
    evidenceAssessment: assessment,
    acsGcipr: solventLayer(match.row, match.matchedOn),
    alternative: {
      ...recommendation.alternative,
      rationale,
    },
    evidence: {
      why_flagged: recommendation.evidence?.why_flagged ?? [],
      why_replacement: recommendation.evidence?.why_replacement ?? [],
      citations: appendCitation(recommendation, citation),
      sdsReferences: recommendation.evidence?.sdsReferences,
      sdsNotes: recommendation.evidence?.sdsNotes,
    },
  }
}


function loadGuides(): ReagentGuideRecord[] {
  if (guideCache) return guideCache
  const parsed = JSON.parse(readFileSync(dataPath('reagent-guides.json'), 'utf8')) as { records: ReagentGuideRecord[] }
  guideCache = parsed.records
  return guideCache
}

export type AcsReactionFamily = 'suzuki' | 'buchwald-hartwig' | 'snar'

/** Fail closed: only explicit family names on the step description. */
export function detectAcsReactionFamily(description: string): AcsReactionFamily | null {
  const text = description ?? ''
  if (/\bsuzuki(?:\s*[-–—]\s*miyaura)?\b/i.test(text)) return 'suzuki'
  if (/\bbuchwald(?:\s*[-–—]\s*hartwig)?\b|\bhartwig\s+amination\b/i.test(text)) return 'buchwald-hartwig'
  if (/\bS\s*N\s*Ar\b/i.test(text) || /\bSNAr\b/.test(text) || /nucleophilic aromatic substitution/i.test(text)) return 'snar'
  return null
}

const FAMILY_LABEL: Record<AcsReactionFamily, string> = {
  suzuki: 'Suzuki-Miyaura',
  'buchwald-hartwig': 'Buchwald-Hartwig',
  snar: 'SNAr',
}

export function acsReagentGuideCard(step: AnalysisStep): Recommendation | null {
  const family = detectAcsReactionFamily(step.description)
  if (!family) return null
  const records = loadGuides().filter(record => record.family === family)
  const guide = records.find(record => record.role === 'guide') ?? records[0]
  if (!guide) return null
  const dois: string[] = []
  const seen = new Set<string>()
  for (const record of records) {
    for (const doi of record.dois) {
      const key = doi.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      dois.push(doi)
    }
  }
  const label = `ACS GCIPR ${FAMILY_LABEL[family]} reagent guide`
  const citations: Citation[] = records.map(record => ({
    source_id: `ACS-GCIPR-${family}-${record.role}-${record.url}`,
    source_name: 'ACS GCI Pharmaceutical Roundtable reagent guide',
    citation: record.claim,
    url: record.url,
    ...(record.dois[0] ? { doi: record.dois[0] } : {}),
  }))
  for (const doi of dois) {
    if (citations.some(citation => citation.doi === doi)) continue
    citations.push({
      source_id: `doi:${doi}`,
      source_name: 'ACS GCI Pharmaceutical Roundtable reagent guide',
      citation: `DOI recorded from the ACS GCIPR ${FAMILY_LABEL[family]} reagent-guide pages.`,
      doi,
      url: `https://doi.org/${doi}`,
    })
  }
  const layer: AcsGciprCitationLayer = {
    source: 'reagent_guide',
    revisesProcedure: false,
    reagentGuide: {
      family,
      guideUrl: guide.url,
      title: guide.title,
      claim: guide.claim,
      dois,
    },
  }
  return {
    stepNumber: step.stepNumber,
    principleNumbers: [5],
    principleNames: ['Safer Solvents and Auxiliaries'],
    severity: 'low',
    original: {
      chemical: label,
      issue: `${FAMILY_LABEL[family]} step matched the ACS GCIPR reagent guide. Citation only; not a procedure change.`,
    },
    alternative: {
      chemical: label,
      rationale: `${guide.claim} Child-page claims and DOIs are attached as citations. Venn green/utility/scale scores that exist only as images are omitted.`,
      yieldImpact: 'Not established.',
      caveats: 'This citation card is not eligible to revise the protocol, even if accepted.',
      evidenceBasis: guide.url,
    },
    confidenceLevel: 'low',
    isAccepted: false,
    evidenceAssessment: {
      disposition: 'supported_with_constraints',
      directness: 'indirect',
      supportingReferenceCount: dois.length,
      applicability: 'partial',
      eligibleForApplication: false,
      eligibilityReason: 'ACS GCIPR reagent-guide citation is supported only as a constraint. It is not supported_applicable and cannot revise protocol text.',
      constraints: ['Do not change solvent, catalyst, ligand, or reagent on the basis of this guide citation alone.'],
    },
    evidence: {
      why_flagged: [],
      why_replacement: [],
      citations,
    },
    acsGcipr: layer,
    primaryBenefit: 'Cites the matching ACS GCIPR reagent guide',
  }
}

function isSolventRole(role: string | undefined): boolean {
  return (role ?? '').trim().toLowerCase() === 'solvent'
}

function countsAsSolventForCitation(name: string, role: string | undefined, smiles?: string): boolean {
  if (isSolventRole(role)) return true
  const label = (role ?? '').trim().toLowerCase()
  if (label !== 'workup' && label !== 'other' && label !== '') return false
  return lookupAcsGciprSolvent({ name, smiles }) !== null
}

function enrichedFor(step: AnalysisStep, name: string, enriched: EnrichedChemical[] | undefined): EnrichedChemical | undefined {
  return enriched?.find(item =>
    item.stepNumber === step.stepNumber
    && item.name.trim().toLowerCase() === name.trim().toLowerCase(),
  )
}

export function applyAcsGciprRecommendations(input: {
  steps: AnalysisStep[]
  enrichedChemicals?: EnrichedChemical[]
  recommendations: Recommendation[]
}): Recommendation[] {
  const annotated = input.recommendations.map(recommendation => {
    const step = input.steps.find(item => item.stepNumber === recommendation.stepNumber)
    if (!step) return recommendation
    const enriched = enrichedFor(step, recommendation.original.chemical, input.enrichedChemicals)
    const chemical = step.chemicals.find(item =>
      item.name.trim().toLowerCase() === recommendation.original.chemical.trim().toLowerCase(),
    )
    const name = chemical?.name ?? enriched?.name
    const role = chemical?.role ?? enriched?.role
    if (!name || !countsAsSolventForCitation(name, role, enriched?.smiles)) return recommendation
    return annotateRecommendationWithAcsSolvent(recommendation, {
      name,
      smiles: enriched?.smiles,
    })
  })

  // No card unless some other source already named a replacement.
  // A catalog hit by itself (water, ethyl acetate) is not a suggestion.
  return annotated
}

export function acsGciprBlocksProcedureRevision(recommendation: Recommendation): boolean {
  return recommendation.acsGcipr?.revisesProcedure === false
}

