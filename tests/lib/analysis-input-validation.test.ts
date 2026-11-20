import { describe, expect, it } from 'vitest'
import {
  validateParsedAnalysisInputs,
  type ProcessUse,
} from '@/lib/analysis-input-validation'
import type { AnalysisStep, ParsedChemical } from '@/lib/types'

const LATIN_ALPHA = '\u0251'
const GREEK_ALPHA = '\u03B1'

function chem(
  name: string,
  role: string = 'reagent',
  quantity: string = '',
  extras: Partial<ParsedChemical> = {},
): ParsedChemical {
  return { name, role, quantity, quantityMl: null, quantityKg: null, ...extras }
}

function step(chemicals: ParsedChemical[], description = 'step description'): AnalysisStep[] {
  return [{
    stepNumber: 1,
    description,
    chemicals,
    conditions: { temperature: null, duration: null, atmosphere: null },
  }]
}

function multiStep(steps: { description: string; chemicals: ParsedChemical[] }[]): AnalysisStep[] {
  return steps.map((s, i) => ({
    stepNumber: i + 1,
    description: s.description,
    chemicals: s.chemicals,
    conditions: { temperature: null, duration: null, atmosphere: null },
  }))
}

describe('parsed-analysis input validation', () => {
  describe('quantity preservation (no first-amount, no aggregation)', () => {
    it('preserves all occurrences of a chemical across steps', () => {
      const input = multiStep([
        { description: 'add reagent', chemicals: [chem('water', 'solvent', '5 mL')] },
        { description: 'add reagent again', chemicals: [chem('water', 'solvent', '20 mL')] },
      ])
      const result = validateParsedAnalysisInputs(input, 'Add 5 mL of water; later add 20 mL of water.')
      expect(result.steps[0].chemicals[0].quantity).toBe('5 mL')
      expect(result.steps[1].chemicals[0].quantity).toBe('20 mL')
    })
    it('does not silently choose the first amount when multiple occurrences exist', () => {
      const input = multiStep([
        { description: 'add', chemicals: [chem('water', 'solvent', '5 mL')] },
        { description: 'add later', chemicals: [chem('water', 'solvent', '20 mL')] },
      ])
      const result = validateParsedAnalysisInputs(input, 'Add 5 mL of water, then 20 mL of water.')
      expect(result.steps[0].chemicals[0].quantity).not.toBe('20 mL')
      expect(result.steps[1].chemicals[0].quantity).not.toBe('5 mL')
    })
    it('does not silently sum separate variant amounts into one chemical', () => {
      const input = multiStep([
        { description: 'add', chemicals: [chem('water', 'solvent', '5 mL')] },
        { description: 'add later', chemicals: [chem('water', 'solvent', '20 mL')] },
      ])
      const result = validateParsedAnalysisInputs(input, 'Add 5 mL of water; later add 20 mL of water.')
      // No synthetic aggregate like "25 mL" should appear
      const quantities = result.steps.flatMap(s => s.chemicals.map(c => c.quantity))
      expect(quantities).not.toContain('25 mL')
    })
    it('flags multi-formulation occurrences for human review without merging them', () => {
      const input = multiStep([
        { description: 'formulation A', chemicals: [chem('water', 'solvent', '5 mL')] },
        { description: 'formulation B', chemicals: [chem('water', 'solvent', '20 mL')] },
      ])
      const result = validateParsedAnalysisInputs(input, 'Two formulations, each adding water.')
      const joined = result.warnings.join(' | ')
      expect(joined).toMatch(/formulation|occurrence|separate/i)
    })
    it('flags a model emission that combined two quantities in a single string', () => {
      // Source clearly separates the amounts into two sentences; if the model
      // emitted one chemical with "5 mL; 20 mL", we cannot safely split it.
      const input = step([chem('water', 'solvent', '5 mL; 20 mL')])
      const source = 'Add 5 mL of water. In step 2, add 20 mL of water.'
      const result = validateParsedAnalysisInputs(input, source)
      const joined = result.warnings.join(' | ')
      expect(joined).toMatch(/separate|formulation|split|occurrence/i)
    })
  })

  describe('pore-size-as-quantity and physical-descriptor-as-quantity', () => {
    it.each([
      ['pore size in nm', '5 nm'],
      ['pore size in Å', '10 Å'],
      ['mesh count', '100 mesh'],
      ['particle size', '~50 µm'],
    ])('flags %s as not a material quantity', (_label, qty) => {
      const result = validateParsedAnalysisInputs(step([chem('silica', 'reagent', qty)]), `Add ${qty} of silica.`)
      const joined = result.warnings.join(' | ')
      expect(joined).toMatch(/pore|physical|descriptor|not a (material )?quantity/i)
    })
    it('does not silently strip the descriptor (preserves verbatim)', () => {
      const result = validateParsedAnalysisInputs(step([chem('silica', 'reagent', '5 nm')]), 'Add 5 nm of silica.')
      // Verbatim quantity preserved; the warning is the only signal.
      expect(result.steps[0].chemicals[0].quantity).toBe('5 nm')
    })
  })

  describe('process-use additive hints (source-grounded only)', () => {
    it('annotates a wash chemical with processUse=wash when source says "wash with"', () => {
      const input = step([chem('water', 'workup', '20 mL')], 'Wash the organic layer with water.')
      const result = validateParsedAnalysisInputs(input, 'Wash the organic layer with water.')
      expect(result.processUseHints?.['0:0']).toBe<ProcessUse>('wash')
    })
    it('does NOT silently reinterpret role=workup as processUse=wash', () => {
      // role=workup is legacy and may include quench, drying, etc. Do not fold.
      const input = step([chem('Na2SO3', 'workup', '0.5 g')], 'Quench with sodium sulfite.')
      const result = validateParsedAnalysisInputs(input, 'Quench with sodium sulfite.')
      expect(result.processUseHints?.['0:0']).toBe<ProcessUse>('quench')
    })
    it('leaves processUse unset when no source-grounded cue exists', () => {
      const input = step([chem('water', 'workup', '20 mL')], 'Add water to the flask.')
      const result = validateParsedAnalysisInputs(input, 'Add water to the flask.')
      expect(result.processUseHints?.['0:0']).toBeUndefined()
    })
    it('detects extraction processUse from "extract with"', () => {
      const input = step([chem('ethyl acetate', 'workup', '20 mL')], 'Extract the aqueous layer with ethyl acetate.')
      const result = validateParsedAnalysisInputs(input, 'Extract the aqueous layer with ethyl acetate.')
      expect(result.processUseHints?.['0:0']).toBe<ProcessUse>('extraction')
    })
    it('detects drying processUse from "dry over"', () => {
      const input = step([chem('Na2SO4', 'workup', '2 g')], 'Dry the organic layer over sodium sulfate.')
      const result = validateParsedAnalysisInputs(input, 'Dry the organic layer over sodium sulfate.')
      expect(result.processUseHints?.['0:0']).toBe<ProcessUse>('drying')
    })
    it('falls back to processUse=reaction when a step is described as a reaction stage and role is reagent/solvent', () => {
      const input = step([chem('HCl', 'reagent', '1 mL')], 'Acidify the mixture with 1 M HCl.')
      const result = validateParsedAnalysisInputs(input, 'Acidify the mixture with 1 M HCl.')
      // acidification is a reaction-stage use; record it as a hint
      expect(result.processUseHints?.['0:0']).toBe<ProcessUse>('reaction')
    })
  })

  describe('conservative source-grounded variant handling', () => {
    it('does not silently merge same-name chemicals across steps that are clearly separate', () => {
      const input = multiStep([
        { description: 'add 5 mL', chemicals: [chem('water', 'solvent', '5 mL')] },
        { description: 'add 20 mL later', chemicals: [chem('water', 'solvent', '20 mL')] },
      ])
      const result = validateParsedAnalysisInputs(input, 'Add 5 mL of water; later add 20 mL of water.')
      // Two distinct occurrences must remain — helper must not collapse them.
      expect(result.steps).toHaveLength(2)
      expect(result.steps[0].chemicals).toHaveLength(1)
      expect(result.steps[1].chemicals).toHaveLength(1)
    })
    it('preserves source-grounded alpha typography for product grounding adjacency', () => {
      // Even though we don't ground products here (declared-products owns that),
      // the helper must not invent or fold chemicals with alpha typography.
      const input = step([
        chem('methanol', 'solvent', '20 mL'),
        chem(`${GREEK_ALPHA}-tocopherol`, 'product', '1 g'),
      ])
      const source = `Isolate the purified ${LATIN_ALPHA}-tocopherol.`
      const result = validateParsedAnalysisInputs(input, source)
      // No merging, no rewriting, no synthetic addition.
      expect(result.steps[0].chemicals).toHaveLength(2)
      expect(result.steps[0].chemicals[1].name).toBe(`${GREEK_ALPHA}-tocopherol`)
    })
    it('does not invent products or aggregate across steps when source does not name a product', () => {
      const input = step([chem('methanol', 'solvent', '20 mL')], 'Concentrate in vacuo.')
      const result = validateParsedAnalysisInputs(input, 'Concentrate the methanol solution in vacuo.')
      // Helper does not add a synthetic product.
      expect(result.steps[0].chemicals.every(c => c.role !== 'product')).toBe(true)
    })
  })

  describe('honesty / unvalidated completeness', () => {
    it('never returns warnings: [] when it cannot confirm complete input', () => {
      // A multi-formulation input must yield at least one warning.
      const input = multiStep([
        { description: 'phase A', chemicals: [chem('water', 'solvent', '5 mL')] },
        { description: 'phase B', chemicals: [chem('water', 'solvent', '20 mL')] },
      ])
      const result = validateParsedAnalysisInputs(input, 'source omitted quantities entirely.')
      expect(result.warnings.length).toBeGreaterThan(0)
    })
    it('requests formulation separation when it cannot safely split', () => {
      const input = step([chem('water', 'solvent', '5 mL; 20 mL')])
      const source = 'Add water. Then add more water.'
      const result = validateParsedAnalysisInputs(input, source)
      const joined = result.warnings.join(' | ')
      expect(joined).toMatch(/separate|split|formulation|human review/i)
    })
    it('records a chemical name collision warning only when same name occurs with conflicting roles in the same step', () => {
      // The parser already de-duplicates by occurrence; the helper warns when
      // it cannot resolve a same-step collision.
      const input = step([
        chem('methanol', 'solvent', '20 mL'),
        chem('methanol', 'reagent', '5 mL'),
      ])
      const source = 'Add methanol as solvent (20 mL) and methanol as reagent (5 mL).'
      const result = validateParsedAnalysisInputs(input, source)
      const joined = result.warnings.join(' | ')
      expect(joined).toMatch(/conflict|same name|role conflict|duplicate/i)
    })
  })

  describe('contract shape', () => {
    it('returns the strict contract { steps, warnings }', () => {
      const result = validateParsedAnalysisInputs(step([]), 'empty protocol.')
      expect(result).toHaveProperty('steps')
      expect(result).toHaveProperty('warnings')
      expect(Array.isArray(result.warnings)).toBe(true)
    })
    it('returns optional processUseHints additive (undefined when no hints)', () => {
      const result = validateParsedAnalysisInputs(step([]), 'empty protocol.')
      // processUseHints is optional and may be undefined
      expect(result.processUseHints === undefined || typeof result.processUseHints === 'object').toBe(true)
    })
  })
})
