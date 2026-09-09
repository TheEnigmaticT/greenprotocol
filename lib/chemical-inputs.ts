import type { AnalysisStep, EnrichedChemical } from '@/lib/types'
import type { BatchResult, ConvertResult } from '@/lib/chemistry-service'

const identity = (name: string) => name.trim().toLowerCase()
const positive = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

/** Join conversions to material occurrences, never to the first matching name. */
export function prepareChemicalInputs(steps: AnalysisStep[], batch: BatchResult | null) {
  const occurrences = steps.flatMap((step, stepIndex) => step.chemicals.map((chemical, chemicalIndex) => ({
    step, chemical, occurrenceId: `${stepIndex}:${chemicalIndex}`,
  })))
  const remaining = new Set((batch?.results ?? []).map((_, index) => index))
  const unresolvedChemicals = new Set<string>()
  const indefiniteChemicals = new Set<string>()
  const enrichedChemicals: EnrichedChemical[] = []
  const scoreChemicals = occurrences.map(({ step, chemical, occurrenceId }) => {
    const quantity = chemical.quantity || ''
    const matching = [...remaining].filter(index => {
      const result = batch!.results[index]
      if (identity(result.chemical_name) !== identity(chemical.name)) return false
      if (typeof result.input_quantity === 'string') return result.input_quantity === quantity
      // Compatibility for old unique-name responses; repeated names require the echo.
      return occurrences.filter(o => identity(o.chemical.name) === identity(chemical.name)).length === 1
    })
    let conversion: ConvertResult | undefined
    if (matching.length) {
      conversion = batch!.results[matching[0]]
      remaining.delete(matching[0])
    }
    const indefinite = conversion?.data_source === 'indefinite'
    const unavailable = !conversion || ['not_found', 'error'].includes(conversion.data_source)
      || ['queued', 'unavailable', 'terminal_not_found'].includes(conversion.reference_status ?? '')
    if (indefinite) indefiniteChemicals.add(chemical.name)
    else if (unavailable) unresolvedChemicals.add(chemical.name)
    const referenceStatus = indefinite ? 'indefinite' : unavailable ? conversion?.reference_status ?? 'unavailable' : 'available'
    const kg = quantity ? positive(conversion?.quantity_kg) : null
    const mol = quantity ? positive(conversion?.quantity_mol) : null
    // Model-supplied converted masses are not a fallback for missing conversion.
    chemical.quantityKg = kg
    const smiles = !indefinite && !unavailable ? conversion?.smiles ?? null : null
    const mw = !indefinite && !unavailable ? positive(conversion?.molecular_weight) : null
    enrichedChemicals.push({
      ...chemical, occurrenceId, stepNumber: step.stepNumber,
      molecular_weight: mw ?? undefined,
      density_g_per_ml: positive(conversion?.density_g_per_ml) ?? undefined,
      smiles: smiles ?? undefined,
      molecular_formula: conversion?.molecular_formula ?? undefined,
      ghs_hazards: conversion?.ghs_hazards ?? [],
      green_alternatives: conversion?.green_alternatives ?? [],
      citations: conversion?.citations ?? [],
      data_source: conversion?.data_source ?? 'error',
      reference_status: referenceStatus,
    })
    return {
      name: chemical.name, role: chemical.role, quantity,
      quantity_g: kg === null ? null : kg * 1000,
      quantity_kg: kg, quantity_mol: mol, molecular_weight: mw,
      step_number: step.stepNumber, smiles, reference_status: referenceStatus,
      raw_quantity: quantity,
      reference_name: conversion?.chemical_name ?? null,
      reference_smiles: smiles,
      reference_provenance: conversion?.data_source ?? null,
    }
  })
  return { enrichedChemicals, scoreChemicals, unresolvedChemicals, indefiniteChemicals }
}
