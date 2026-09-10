import { isEvidenceEligibleChemicalSwap } from '@/lib/recommendation-kind'
import type {
  AnalysisResult,
  CumulativeImpact,
  EnrichedChemical,
  ImpactDelta,
  ImpactInventoryRow,
  ImpactInventorySnapshot,
  ParsedChemical,
  Recommendation,
} from '@/lib/types'

type Scenario = 'proposed' | 'accepted'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * This is a runtime safety boundary for the inventory builder, not a chemistry
 * validator. It only checks fields that the builder dereferences.
 */
export function isImpactInventoryCompatibleAnalysisResult(value: unknown): value is AnalysisResult {
  if (!record(value) || !Array.isArray(value.steps) || !Array.isArray(value.recommendations)) return false
  if (value.enrichedChemicals !== undefined && (!Array.isArray(value.enrichedChemicals)
    || !value.enrichedChemicals.every((chemical) => record(chemical) && typeof chemical.name === 'string'))) return false
  return value.steps.every((step) => record(step)
    && typeof step.stepNumber === 'number'
    && Array.isArray(step.chemicals)
    && step.chemicals.every((chemical) => record(chemical) && typeof chemical.name === 'string'))
    && value.recommendations.every((recommendation) => record(recommendation)
      && record(recommendation.original) && typeof recommendation.original.chemical === 'string'
      && record(recommendation.alternative) && typeof recommendation.alternative.chemical === 'string')
}

/** Explicit unavailable status overrides legacy numeric fields; missing status stays legacy-compatible. */
export function impactIsExplicitlyUnavailable(delta: Pick<ImpactDelta, 'assessment'> | null | undefined): boolean {
  return delta?.assessment?.level === 'unavailable'
}

export interface ClaimableImpactAggregate extends Omit<CumulativeImpact, 'totalAnalyses'> {
  claimedAnalyses: number
  unavailableAnalyses: number
}

function finiteImpactNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Aggregate only impacts that are not explicitly unavailable. */
export function aggregateClaimableImpact(deltas: readonly ImpactDelta[]): ClaimableImpactAggregate {
  const aggregate: ClaimableImpactAggregate = {
    co2eSavedKg: 0,
    hazardousWasteEliminatedKg: 0,
    carcinogensEliminated: [],
    waterSavedL: 0,
    energySavedKwh: 0,
    claimedAnalyses: 0,
    unavailableAnalyses: 0,
  }
  for (const delta of deltas) {
    if (impactIsExplicitlyUnavailable(delta)) {
      aggregate.unavailableAnalyses += 1
      continue
    }
    aggregate.claimedAnalyses += 1
    aggregate.co2eSavedKg += finiteImpactNumber(delta.co2eSavedKg)
    aggregate.hazardousWasteEliminatedKg += finiteImpactNumber(delta.hazardousWasteEliminatedKg)
    aggregate.waterSavedL += finiteImpactNumber(delta.waterSavedL)
    aggregate.energySavedKwh += finiteImpactNumber(delta.energySavedKwh)
    for (const chemical of Array.isArray(delta.carcinogensEliminated) ? delta.carcinogensEliminated : []) {
      if (typeof chemical === 'string' && !aggregate.carcinogensEliminated.includes(chemical)) {
        aggregate.carcinogensEliminated.push(chemical)
      }
    }
  }
  return aggregate
}

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

function matchedEnrichment(chemical: ParsedChemical, enriched: EnrichedChemical[] | undefined): EnrichedChemical | undefined {
  const name = normalized(chemical.name)
  return enriched?.find((candidate) => normalized(candidate.name) === name)
}

function knownQuantity(chemical: ParsedChemical): ImpactInventoryRow['quantity'] {
  const massKg = typeof chemical.quantityKg === 'number' && Number.isFinite(chemical.quantityKg) && chemical.quantityKg > 0
    ? chemical.quantityKg : undefined
  const volumeMl = typeof chemical.quantityMl === 'number' && Number.isFinite(chemical.quantityMl) && chemical.quantityMl > 0
    ? chemical.quantityMl : undefined
  if (massKg === undefined && volumeMl === undefined) {
    return { state: 'unknown', declaredText: chemical.quantity || undefined }
  }
  return { state: 'known', massKg, volumeMl, declaredText: chemical.quantity || undefined }
}

function hasNonPositiveParsedQuantity(chemical: ParsedChemical): boolean {
  return [chemical.quantityKg, chemical.quantityMl].some((quantity) =>
    typeof quantity === 'number' && Number.isFinite(quantity) && quantity <= 0,
  )
}

function baselineRows(result: AnalysisResult): ImpactInventoryRow[] {
  return result.steps.flatMap((step) => step.chemicals.map((chemical, index) => {
    const enrichment = matchedEnrichment(chemical, result.enrichedChemicals)
    // Quantities are model-extracted from the submitted protocol, not measured consumption.
    const provenance = ['model_extracted_protocol']
    if (enrichment?.data_source) provenance.push(enrichment.data_source)
    if (enrichment?.reference_status) provenance.push(`reference_status:${enrichment.reference_status}`)
    return {
      rowId: `baseline:${step.stepNumber}:${index}:${normalized(chemical.name)}`,
      scenario: 'baseline' as const,
      stepNumber: step.stepNumber,
      chemical: chemical.name,
      role: chemical.role || undefined,
      quantity: knownQuantity(chemical),
      provenance,
    }
  }))
}

function selectedSwaps(recommendations: Recommendation[], scenario: Scenario): Recommendation[] {
  return recommendations.filter((recommendation) =>
    isEvidenceEligibleChemicalSwap(recommendation)
    && (scenario === 'proposed' || recommendation.isAccepted === true),
  )
}

function afterRows(before: ImpactInventoryRow[], recommendations: Recommendation[], scenario: Scenario): ImpactInventoryRow[] {
  const swaps = selectedSwaps(recommendations, scenario)
  const replacedMaterials = new Set(swaps.map((recommendation) =>
    `${recommendation.stepNumber}:${normalized(recommendation.original.chemical)}`,
  ))
  const unchanged = before
    .filter((row) => !replacedMaterials.has(`${row.stepNumber}:${normalized(row.chemical)}`))
    .map((row) => ({
      ...row,
      rowId: `${scenario}:unchanged:${row.rowId}`,
      scenario,
    } as ImpactInventoryRow))
  const replacements = swaps.map((recommendation, index) => ({
    rowId: `${scenario}:${recommendation.stepNumber}:${index}:${normalized(recommendation.original.chemical)}:${normalized(recommendation.alternative.chemical)}`,
    scenario,
    stepNumber: recommendation.stepNumber,
    chemical: recommendation.alternative.chemical,
    originalChemical: recommendation.original.chemical,
    // A recommendation never supplies a process quantity. Do not copy the original.
    quantity: { state: 'unknown' as const },
    provenance: [
      'recommendation',
      `application_eligibility:${recommendation.applicationEligibility?.status ?? 'unavailable'}`,
      ...(recommendation.applicationEligibility?.reason ? [recommendation.applicationEligibility.reason] : []),
    ],
    evidenceEligibility: recommendation.applicationEligibility?.status,
  } satisfies ImpactInventoryRow))
  return [...unchanged, ...replacements]
}

/**
 * Builds the persisted material boundary used by impact consumers. It records
 * source quantities as submitted, and deliberately leaves replacement amounts
 * unknown until a distinct scenario provides them.
 */
export function buildImpactInventory(result: AnalysisResult, scenario: Scenario = 'proposed'): ImpactInventorySnapshot {
  const before = baselineRows(result)
  const after = afterRows(before, result.recommendations, scenario)
  const swaps = selectedSwaps(result.recommendations, scenario)
  const missingInputs: string[] = []

  for (const row of before.filter((row) => row.quantity.state === 'unknown')) {
    const source = result.steps
      .find((step) => step.stepNumber === row.stepNumber)
      ?.chemicals.find((chemical) => normalized(chemical.name) === normalized(row.chemical))
    missingInputs.push(`Submitted-batch quantity is ${source && hasNonPositiveParsedQuantity(source) ? 'missing or non-positive' : 'missing'} for ${row.chemical}${row.stepNumber ? ` (step ${row.stepNumber})` : ''}.`)
  }
  if (swaps.length === 0) {
    missingInputs.push(scenario === 'accepted'
      ? 'No accepted evidence-supported chemical substitution is available for impact comparison.'
      : 'No evidence-supported chemical substitution is available for impact comparison.')
  }
  for (const row of after.filter((row) => row.originalChemical)) {
    missingInputs.push(`Replacement quantity for ${row.originalChemical} → ${row.chemical} has not been provided; original mass was not reused.`)
  }
  if (swaps.length > 0) {
    missingInputs.push('Substitution-specific impact factors are unavailable; no screening estimate or LCA result is reported.')
  }
  missingInputs.push('Functional unit is the submitted batch because product output or yield is missing; results are not normalized to product output.')

  return {
    version: 'impact-inventory/v1',
    boundary: {
      functionalUnit: 'submitted_batch',
      productOutputStatus: 'unknown',
      limitations: [
        'Inventory reflects parsed submitted inputs, not measured consumption, waste, recovery, or emissions.',
        'Product output/yield is unavailable, so the batch cannot be normalized to product output.',
      ],
    },
    baselineRows: before,
    afterRows: after,
    missingInputs,
  }
}

/**
 * Preserves legacy numeric fields while making their unavailable status
 * authoritative for every impact consumer.
 */
export function buildUnavailableImpact(
  result: AnalysisResult,
  scenario: Scenario = 'proposed',
  inventory = buildImpactInventory(result, scenario),
): ImpactDelta {
  return {
    co2eSavedKg: 0,
    hazardousWasteEliminatedKg: 0,
    carcinogensEliminated: [],
    waterSavedL: 0,
    energySavedKwh: 0,
    inventory,
    assessment: {
      level: 'unavailable',
      reasons: inventory.missingInputs,
    },
  }
}
