/**
 * Client-side projected score estimation after accepting/declining recommendations.
 *
 * For principles where we can re-estimate from local chemical DB data (P3, P5, P7, P10, P12),
 * we recalculate using the same formulas as the Python scoring service.
 * For principles we can't recalculate (P1, P2, P4, P6, P8, P9, P11), we keep the original score.
 */

import { AnalysisResult, DeterministicScores, PrincipleScore } from './types'
import { findChemical } from './chemicals'

// H-code scoring tables (mirrored from services/chemistry/ghs.py)
const HEALTH_SCORES: Record<string, number> = {
  H300: 10, H301: 8, H302: 4, H303: 2,
  H310: 10, H311: 8, H312: 4, H313: 2,
  H330: 10, H331: 8, H332: 4, H333: 2,
  H314: 8, H315: 3, H316: 1,
  H317: 4, H318: 6, H319: 3, H320: 1,
  H334: 6, H335: 3, H336: 3,
  H340: 10, H341: 7, H350: 10, H351: 7,
  H360: 10, H361: 7, H360D: 10, H360F: 10,
  H370: 10, H371: 7, H372: 8, H373: 5,
}

const PHYSICAL_SCORES: Record<string, number> = {
  H200: 10, H201: 10, H202: 8, H203: 6, H204: 6, H205: 4,
  H220: 8, H221: 6, H222: 6, H223: 4,
  H224: 8, H225: 6, H226: 4, H227: 2, H228: 6,
  H240: 10, H241: 8, H242: 6,
  H250: 8, H251: 6, H252: 4,
  H260: 8, H261: 6,
  H270: 6, H271: 6, H272: 4,
  H280: 3, H281: 5, H290: 3,
}

const ENV_SCORES: Record<string, number> = {
  H400: 8, H401: 5, H402: 3,
  H410: 10, H411: 8, H412: 5, H413: 3,
  H420: 8,
}

const CHEM21_WEIGHTS: Record<string, number> = {
  recommended: 1,
  problematic: 5,
  hazardous: 8,
  highly_hazardous: 10,
}

function maxHazardScore(hcodes: string[], table: Record<string, number>): number {
  if (!hcodes.length) return 0
  return Math.min(10, Math.max(...hcodes.map(h => table[h] || 0)))
}

interface ChemSlot {
  name: string
  role: string
  quantityKg: number
  hcodes: string[]
  chem21Class: string
  isRenewable: boolean
}

/**
 * Build a chemical inventory reflecting accepted swaps.
 * For each accepted recommendation, replace the original chemical with the alternative.
 */
function buildProjectedChemicals(analysis: AnalysisResult): ChemSlot[] {
  // Build the original chemical list from parsed steps
  const slots: ChemSlot[] = []
  for (const step of analysis.steps) {
    for (const chem of step.chemicals) {
      const data = findChemical(chem.name)
      let qty = chem.quantityKg ?? 0
      if (!qty && chem.quantityMl && data) {
        qty = (chem.quantityMl / 1000) * data.densityKgPerL
      }
      if (!qty) qty = chem.role === 'solvent' ? 0.5 : 0.1

      slots.push({
        name: chem.name,
        role: chem.role,
        quantityKg: qty,
        hcodes: data?.ghsHazards ?? [],
        chem21Class: data?.chem21Class ?? 'problematic',
        isRenewable: false, // default, no field in ChemicalData yet
      })
    }
  }

  // Apply accepted swaps
  for (const rec of analysis.recommendations) {
    if (rec.isAccepted !== true) continue
    const altData = findChemical(rec.alternative.chemical)
    if (!altData) continue

    // Find matching slots in the same step
    for (const slot of slots) {
      const origData = findChemical(rec.original.chemical)
      if (!origData) continue

      const slotLower = slot.name.toLowerCase()
      const origLower = rec.original.chemical.toLowerCase()
      const isMatch = slotLower === origLower ||
        slotLower.includes(origLower) || origLower.includes(slotLower)

      if (isMatch) {
        slot.name = altData.name
        slot.hcodes = altData.ghsHazards
        slot.chem21Class = altData.chem21Class
      }
    }
  }

  return slots
}

function scoreP3(slots: ChemSlot[]): number {
  const totalMass = slots.reduce((s, c) => s + c.quantityKg, 0)
  if (totalMass <= 0) return 0
  let weightedHazard = 0
  for (const c of slots) {
    const healthScore = maxHazardScore(c.hcodes, HEALTH_SCORES)
    weightedHazard += healthScore * c.quantityKg
  }
  return Math.min(10, Math.round((weightedHazard / totalMass) * 100) / 100)
}

function scoreP5(slots: ChemSlot[]): number {
  const solvents = slots.filter(c =>
    c.role.toLowerCase().includes('solvent') || c.role.toLowerCase().includes('wash'))
  const totalMass = solvents.reduce((s, c) => s + c.quantityKg, 0)
  if (totalMass <= 0) return 0
  let weightedHazard = 0
  for (const c of solvents) {
    const weight = CHEM21_WEIGHTS[c.chem21Class] || 5
    weightedHazard += weight * c.quantityKg
  }
  return Math.min(10, Math.round((weightedHazard / totalMass) * 100) / 100)
}

function scoreP10(slots: ChemSlot[]): number {
  const totalMass = slots.reduce((s, c) => s + c.quantityKg, 0)
  if (totalMass <= 0) return 0
  let weightedHazard = 0
  for (const c of slots) {
    const envScore = maxHazardScore(c.hcodes, ENV_SCORES)
    weightedHazard += envScore * c.quantityKg
  }
  return Math.min(10, Math.round((weightedHazard / totalMass) * 100) / 100)
}

function scoreP12(slots: ChemSlot[]): number {
  const totalMass = slots.reduce((s, c) => s + c.quantityKg, 0)
  if (totalMass <= 0) return 0
  let weightedHazard = 0
  for (const c of slots) {
    const physScore = maxHazardScore(c.hcodes, PHYSICAL_SCORES)
    weightedHazard += physScore * c.quantityKg
  }
  return Math.min(10, Math.round((weightedHazard / totalMass) * 100) / 100)
}

/**
 * Project new deterministic scores based on accepted recommendations.
 * Returns null if no deterministic scores exist or no recs are accepted.
 */
export function projectScores(analysis: AnalysisResult): DeterministicScores | null {
  if (!analysis.deterministicScores) return null

  const acceptedCount = analysis.recommendations.filter(r => r.isAccepted === true).length
  if (acceptedCount === 0) return null

  const slots = buildProjectedChemicals(analysis)
  const original = analysis.deterministicScores

  // Clone scores and replace the ones we can recalculate
  const projectedScores: PrincipleScore[] = original.scores.map(s => {
    const clone = { ...s, details: { ...s.details } }

    switch (s.principle_number) {
      case 3: {
        const newScore = scoreP3(slots)
        return { ...clone, score: newScore, normalized: newScore / 10, confidence: 'estimated' as const }
      }
      case 5: {
        const newScore = scoreP5(slots)
        return { ...clone, score: newScore, normalized: newScore / 10, confidence: 'estimated' as const }
      }
      case 10: {
        const newScore = scoreP10(slots)
        return { ...clone, score: newScore, normalized: newScore / 10, confidence: 'estimated' as const }
      }
      case 12: {
        const newScore = scoreP12(slots)
        return { ...clone, score: newScore, normalized: newScore / 10, confidence: 'estimated' as const }
      }
      default:
        return clone
    }
  })

  const available = projectedScores.filter(s => s.score >= 0)
  const totalScore = available.reduce((sum, s) => sum + s.score, 0)
  const maxPossible = available.length * 10

  const pct = maxPossible > 0 ? (totalScore / maxPossible) * 100 : 0
  let grade: string
  if (pct <= 20) grade = 'A'
  else if (pct <= 40) grade = 'B'
  else if (pct <= 60) grade = 'C'
  else if (pct <= 80) grade = 'D'
  else grade = 'F'

  return {
    scores: projectedScores,
    total_score: Math.round(totalScore * 100) / 100,
    max_possible: maxPossible,
    grade,
    smiles_extraction: original.smiles_extraction,
    yield_extraction: original.yield_extraction,
  }
}
