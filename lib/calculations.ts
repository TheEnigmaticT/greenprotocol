import { AnalysisResult } from './types'
import { findChemical } from './chemicals'

export function calculateOriginalTotals(analysis: AnalysisResult) {
  let co2eKg = 0
  let hazWasteKg = 0
  let waterL = 0
  let energyKwh = 0

  for (const step of analysis.steps) {
    for (const chem of step.chemicals) {
      const data = findChemical(chem.name)
      if (!data) continue

      let qty = chem.quantityKg
      if (!qty && chem.quantityMl) {
        qty = (chem.quantityMl / 1000) * data.densityKgPerL
      }
      if (!qty) qty = chem.role === 'solvent' ? 0.5 : 0.1

      co2eKg += qty * data.co2ePerKg
      waterL += qty * data.waterPerKg
      energyKwh += qty * data.energyPerKg
      if (data.isHazardousWaste) hazWasteKg += qty
    }
  }

  return { co2eKg, hazWasteKg, waterL, energyKwh }
}
