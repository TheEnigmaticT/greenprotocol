import { describe, expect, it } from 'vitest'
import type { Recommendation } from '@/lib/types'
import { buildAssemblePrompt } from '@/lib/prompts/assemble'
import { buildFinalizedProtocol } from '@/lib/finalized-protocol'
import {
  baseChemicalName,
  classifyRecommendationKind,
  kindBadgeLabel,
  recommendationsForAssemble,
  recommendationsForLiteratureReevaluation,
} from '@/lib/recommendation-kind'

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const {
    original: originalOverride,
    alternative: alternativeOverride,
    ...rest
  } = overrides
  return {
    stepNumber: 1,
    principleNumbers: [5],
    principleNames: ['Safer Solvents'],
    severity: 'medium',
    confidenceLevel: 'medium',
    original: {
      chemical: 'dichloromethane',
      issue: 'hazardous solvent',
      ...(originalOverride ?? {}),
    },
    alternative: {
      chemical: 'ethyl acetate',
      rationale: 'greener solvent',
      yieldImpact: 'comparable',
      caveats: '',
      evidenceBasis: 'CHEM21',
      ...(alternativeOverride ?? {}),
    },
    ...rest,
  }
}

describe('classifyRecommendationKind', () => {
  it.each([
    'Pd(PPh3)4 at 1–2 mol% (0.12–0.23 g)',
    'Pd(PPh3)4 at 1 mol%',
    'Pd(PPh3)4 at 0.12 g',
  ])('excludes same-catalyst numeric dose changes from substitution consumers: %s', (chemical) => {
    const rec = makeRec({
      kind: 'chemical_swap',
      original: { chemical: 'Pd(PPh3)4', issue: 'Excess catalyst' },
      alternative: { chemical, rationale: 'Use less catalyst', yieldImpact: '', caveats: '', evidenceBasis: '' },
      applicationEligibility: { status: 'supported', reason: 'Consumer must still check kind' },
    })
    expect(classifyRecommendationKind(rec)).toBe('process_change')
    expect(recommendationsForLiteratureReevaluation([rec])).toEqual([])
    expect(recommendationsForAssemble([rec])).toEqual([])
  })

  it('preserves chemical formula groups when comparing distinct replacement identities', () => {
    expect(baseChemicalName('Zn(OH)2')).toBe('zn(oh)2')
    const rec = makeRec({
      original: { chemical: 'Zn(OH)2', issue: 'Different reagent needed' },
      alternative: { chemical: 'Zn(OAc)2 at 1 mol%', rationale: 'Distinct compound', yieldImpact: '', caveats: '', evidenceBasis: '' },
    })
    expect(classifyRecommendationKind(rec)).toBe('chemical_swap')
  })

  it.each([
    'add phosphoric acid slowly with continuous stirring and pre-cool the flask to 0–5 °C before addition',
    'Reduce phenylboronic acid to exact 1:1 stoichiometry (10 mmol, 1.22 g) and K2CO3 to 1–2 equiv (1.38–2.76 g) to minimize inorganic byproduct mass',
    'Reduce Pd loading to 1–2 mol% or switch to a heterogeneous Pd/C catalyst (with catalyst recycling) to lower the mass of non-product material processed',
    'Reduced acetic anhydride volume (1.5–2.0 mL, ~1.2–1.5 equiv)',
    'Slow, portion-wise addition of cold water with stirring',
    'Crystallization from ethyl acetate/hexane or heptane',
    'Acetic acid recovery from aqueous waste stream (step 4–5)',
  ])('keeps live Qwen process instructions out of substitution consumers: %s', (chemical) => {
    const rec = makeRec({
      kind: 'process_change',
      alternative: { chemical, rationale: 'Process optimization', yieldImpact: '', caveats: '', evidenceBasis: '' },
    })
    expect(classifyRecommendationKind(rec)).toBe('process_change')
    expect(recommendationsForLiteratureReevaluation([rec])).toEqual([])
    expect(recommendationsForAssemble([rec])).toEqual([])
  })

  it('defaults missing kind to chemical_swap for real substitutions', () => {
    expect(classifyRecommendationKind(makeRec({ kind: undefined }))).toBe('chemical_swap')
  })

  it('classifies anhydride→TLC-style tips as analytical', () => {
    const rec = makeRec({
      kind: undefined,
      original: { chemical: 'acetic anhydride', issue: 'endpoint unclear' },
      alternative: {
        chemical: 'TLC',
        rationale: 'Use TLC monitoring to stop before over-acylation',
        yieldImpact: 'n/a',
        caveats: '',
        evidenceBasis: 'lab practice',
      },
    })
    expect(classifyRecommendationKind(rec)).toBe('analytical')
    expect(kindBadgeLabel('analytical')).toBe('Analytical')
  })

  it('classifies same-reagent / modified-addition tips as process_change even with different alt name', () => {
    const rec = makeRec({
      kind: 'chemical_swap',
      original: { chemical: 'acetic anhydride', issue: 'exothermic quench' },
      alternative: {
        chemical: 'water (same reagent, modified addition rate)',
        rationale: 'Add water slowly to the same anhydride mixture',
        yieldImpact: 'n/a',
        caveats: '',
        evidenceBasis: 'lab practice',
      },
    })
    expect(classifyRecommendationKind(rec)).toBe('process_change')
  })

  it('classifies same-chemical dose tips as process_change', () => {
    const rec = makeRec({
      kind: undefined,
      original: { chemical: 'acetic anhydride', issue: 'excess reagent' },
      alternative: {
        chemical: 'acetic anhydride',
        rationale: 'Reduce dose / equivalents to cut waste',
        yieldImpact: 'may lower conversion',
        caveats: '',
        evidenceBasis: 'atom economy',
      },
    })
    expect(classifyRecommendationKind(rec)).toBe('process_change')
    expect(kindBadgeLabel('process_change')).toBe('Process')
  })

  it('classifies microwave / reflux-time tips as process_change', () => {
    const rec = makeRec({
      original: { chemical: 'reaction mixture', issue: 'prolonged heating' },
      alternative: {
        chemical: 'microwave heating',
        rationale: 'Shorten reflux time with microwave assistance',
        yieldImpact: 'comparable',
        caveats: '',
        evidenceBasis: 'energy efficiency',
      },
    })
    expect(classifyRecommendationKind(rec)).toBe('process_change')
  })

  it('prefers model kind when sensible', () => {
    expect(
      classifyRecommendationKind(
        makeRec({
          kind: 'process_change',
          original: { chemical: 'ethanol', issue: 'energy' },
          alternative: {
            chemical: 'ambient temperature',
            rationale: 'Run at ambient temperature',
            yieldImpact: '',
            caveats: '',
            evidenceBasis: '',
          },
        })
      )
    ).toBe('process_change')
  })

  it('overrides obvious chemical_swap mislabels that are tips', () => {
    expect(
      classifyRecommendationKind(
        makeRec({
          kind: 'chemical_swap',
          original: { chemical: 'acetic anhydride', issue: 'monitor conversion' },
          alternative: {
            chemical: 'inline IR',
            rationale: 'Add real-time monitoring',
            yieldImpact: '',
            caveats: '',
            evidenceBasis: '',
          },
        })
      )
    ).toBe('analytical')
  })

  it('overrides tip mislabels on clear distinct-chemical swaps', () => {
    expect(
      classifyRecommendationKind(
        makeRec({
          kind: 'analytical',
          original: { chemical: 'DMF', issue: 'toxic solvent' },
          alternative: {
            chemical: 'DMSO',
            rationale: 'safer polar aprotic solvent',
            yieldImpact: 'comparable',
            caveats: '',
            evidenceBasis: 'CHEM21',
          },
        })
      )
    ).toBe('chemical_swap')
  })

  it('classifies phosphoric acid → Amberlyst-15 resin as chemical_swap (not Process)', () => {
    const rec = makeRec({
      kind: 'process_change',
      original: { chemical: 'phosphoric acid', issue: 'corrosive homogeneous catalyst' },
      alternative: {
        chemical: 'Amberlyst-15 (sulfonic acid resin)',
        rationale: 'Solid ion-exchange sulfonic acid resin catalyst; easier separation and lower aqueous waste',
        yieldImpact: 'comparable',
        caveats: '',
        evidenceBasis: 'green catalysis',
      },
      primaryBenefit: 'Safer catalyst handling and energy efficiency',
    })
    expect(classifyRecommendationKind(rec)).toBe('chemical_swap')
    expect(kindBadgeLabel('chemical_swap')).toBe('Substitution')
  })

  it('overrides a declared swap when the alternative is only a dose instruction', () => {
    expect(classifyRecommendationKind(makeRec({
      kind: 'chemical_swap',
      alternative: { chemical: 'reduce catalyst loading', rationale: 'Use less catalyst', yieldImpact: '', caveats: '', evidenceBasis: '' },
    }))).toBe('process_change')
  })

  it('keeps a real reagent swap as chemical_swap when its rationale mentions monitoring', () => {
    expect(classifyRecommendationKind(makeRec({
      kind: 'analytical',
      original: { chemical: 'chromium(VI) oxidant', issue: 'toxic oxidant' },
      alternative: {
        chemical: 'TEMPO/bleach oxidation',
        rationale: 'Use real-time monitoring of pH during addition to maintain selective oxidation',
        yieldImpact: 'requires optimization', caveats: '', evidenceBasis: 'published precedent',
      },
    }))).toBe('chemical_swap')
  })

  it('classifies water → water (added slowly…) as process_change', () => {
    const rec = makeRec({
      kind: 'chemical_swap',
      original: { chemical: 'water', issue: 'addition rate' },
      alternative: {
        chemical: 'water (added slowly with stirring)',
        rationale: 'Add slowly with stirring to control exotherm',
        yieldImpact: 'n/a',
        caveats: '',
        evidenceBasis: 'lab practice',
      },
    })
    expect(classifyRecommendationKind(rec)).toBe('process_change')
  })

  it('classifies acetic anhydride → TLC or inline IR monitoring as analytical', () => {
    const rec = makeRec({
      kind: 'chemical_swap',
      original: { chemical: 'acetic anhydride', issue: 'endpoint unclear' },
      alternative: {
        chemical: 'TLC or inline IR monitoring',
        rationale: 'Use TLC or inline IR monitoring to stop before over-acylation',
        yieldImpact: 'n/a',
        caveats: '',
        evidenceBasis: 'lab practice',
      },
    })
    expect(classifyRecommendationKind(rec)).toBe('analytical')
  })

  it('classifies acetic anhydride → acetic anhydride (reduced quantity…) as process_change', () => {
    const rec = makeRec({
      kind: 'chemical_swap',
      original: { chemical: 'acetic anhydride', issue: 'excess reagent' },
      alternative: {
        chemical: 'acetic anhydride (reduced quantity to improve atom economy)',
        rationale: 'Use reduced quantity / fewer equivalents',
        yieldImpact: 'may lower conversion',
        caveats: '',
        evidenceBasis: 'atom economy',
      },
    })
    expect(classifyRecommendationKind(rec)).toBe('process_change')
  })

  it('classifies room-temp process tip as process_change', () => {
    const rec = makeRec({
      kind: undefined,
      original: { chemical: 'reaction mixture', issue: 'prolonged heating' },
      alternative: {
        chemical: 'room temperature',
        rationale: 'Run at room-temp instead of prolonged heating',
        yieldImpact: 'comparable',
        caveats: '',
        evidenceBasis: 'energy efficiency',
      },
    })
    expect(classifyRecommendationKind(rec)).toBe('process_change')
  })
})

describe('assemble filtering', () => {
  it('retains an unsupported swap as a hypothesis but excludes it from protocol assembly', () => {
    const unsupported = makeRec({
      kind: 'chemical_swap',
      original: { chemical: 'acetic anhydride', issue: 'corrosive acylating agent' },
      alternative: {
        chemical: 'acetic acid',
        rationale: 'Proposed safer acyl source',
        yieldImpact: 'Unknown',
        caveats: 'No matching reaction evidence',
        evidenceBasis: '',
      },
      applicationEligibility: {
        status: 'hypothesis_only',
        reason: 'Literature re-evaluation did not support the alternative in this context.',
      },
    })

    expect(recommendationsForAssemble([unsupported])).toEqual([])
    expect(recommendationsForLiteratureReevaluation([unsupported])).toEqual([unsupported])
  })

  it('passes only chemical_swap recommendations into assemble prompt payload', () => {
    const swap = makeRec({
      kind: 'chemical_swap',
      applicationEligibility: { status: 'supported', reason: 'Applicable literature evidence confirmed this swap.' },
      original: { chemical: 'DCM', issue: 'hazard' },
      alternative: {
        chemical: 'EtOAc',
        rationale: 'safer',
        yieldImpact: '',
        caveats: '',
        evidenceBasis: '',
      },
    })
    const tip = makeRec({
      kind: 'analytical',
      original: { chemical: 'acetic anhydride', issue: 'endpoint' },
      alternative: {
        chemical: 'TLC',
        rationale: 'monitor by TLC',
        yieldImpact: '',
        caveats: '',
        evidenceBasis: '',
      },
    })

    const forAssemble = recommendationsForAssemble([swap, tip])
    expect(forAssemble).toHaveLength(1)
    expect(forAssemble[0].alternative.chemical).toBe('EtOAc')

    const forLit = recommendationsForLiteratureReevaluation([swap, tip])
    expect(forLit).toEqual(forAssemble)

    const prompt = buildAssemblePrompt('Protocol text with DCM.', [], forAssemble)
    expect(prompt).toContain('EtOAc')
    expect(prompt).not.toContain('"chemical": "TLC"')
    expect(prompt).toContain('chemical_swap only')
  })
})

describe('buildFinalizedProtocol chemical_swap-only apply', () => {
  it('does not return a preassembled protocol that applied an accepted unsupported hypothesis', () => {
    const original = 'Dissolve salicylic acid in acetic anhydride and heat.'
    const analysis = {
      protocolTitle: 'Aspirin',
      chemistrySubdomain: 'organic',
      steps: [],
      recommendations: [makeRec({
        kind: 'chemical_swap',
        isAccepted: true,
        original: { chemical: 'acetic anhydride', issue: 'corrosive' },
        alternative: { chemical: 'acetic acid', rationale: 'hypothesis', yieldImpact: '', caveats: '', evidenceBasis: '' },
        applicationEligibility: { status: 'hypothesis_only', reason: 'No applicable reaction evidence.' },
      })],
      revisedProtocol: 'Dissolve salicylic acid in acetic acid and heat.',
      overallAssessment: {
        greenPrinciplesViolated: [5], mostImpactfulChange: 'swap', experimentalValidationNeeded: true, disclaimer: 'test',
      },
    }

    expect(buildFinalizedProtocol(analysis, original)).toBe(original)
  })

  it('applies accepted chemical swaps but ignores accepted tips', () => {
    const analysis = {
      protocolTitle: 'Aspirin',
      chemistrySubdomain: 'organic',
      steps: [
        {
          stepNumber: 1,
          description: 'Dissolve salicylic acid in acetic anhydride and heat.',
          chemicals: [],
          conditions: { temperature: null, duration: null, atmosphere: null },
        },
      ],
      recommendations: [
        makeRec({
          kind: 'chemical_swap',
          isAccepted: true,
          applicationEligibility: { status: 'supported', reason: 'Applicable literature evidence confirmed this swap.' },
          stepNumber: 1,
          original: { chemical: 'acetic anhydride', issue: 'corrosive' },
          alternative: {
            chemical: 'acetic acid',
            rationale: 'safer acyl source',
            yieldImpact: 'may lower yield',
            caveats: '',
            evidenceBasis: '',
          },
        }),
        makeRec({
          kind: 'analytical',
          isAccepted: true,
          stepNumber: 1,
          original: { chemical: 'acetic anhydride', issue: 'endpoint' },
          alternative: {
            chemical: 'TLC',
            rationale: 'monitor conversion by TLC',
            yieldImpact: '',
            caveats: '',
            evidenceBasis: '',
          },
        }),
        makeRec({
          kind: 'process_change',
          isAccepted: true,
          stepNumber: 1,
          original: { chemical: 'salicylic acid', issue: 'excess' },
          alternative: {
            chemical: 'salicylic acid',
            rationale: 'Reduce dose',
            yieldImpact: '',
            caveats: '',
            evidenceBasis: '',
          },
        }),
      ],
      revisedProtocol: '',
      overallAssessment: {
        greenPrinciplesViolated: [5],
        mostImpactfulChange: 'swap',
        experimentalValidationNeeded: true,
        disclaimer: 'test',
      },
    }

    const finalized = buildFinalizedProtocol(analysis, 'Dissolve salicylic acid in acetic anhydride and heat.')
    expect(finalized).toContain('acetic acid')
    expect(finalized).not.toContain('acetic anhydride')
    expect(finalized).not.toMatch(/\bTLC\b/)
    expect(finalized).toContain('salicylic acid')
  })

  it('does not rewrite protocol when only tips are accepted', () => {
    const original = 'Heat acetic anhydride under reflux.'
    const analysis = {
      protocolTitle: 'Tip only',
      chemistrySubdomain: 'organic',
      steps: [],
      recommendations: [
        makeRec({
          kind: 'process_change',
          isAccepted: true,
          original: { chemical: 'acetic anhydride', issue: 'energy' },
          alternative: {
            chemical: 'acetic anhydride',
            rationale: 'Lower temperature / shorter reflux time',
            yieldImpact: '',
            caveats: '',
            evidenceBasis: '',
          },
        }),
      ],
      revisedProtocol: '',
      overallAssessment: {
        greenPrinciplesViolated: [6],
        mostImpactfulChange: 'tip',
        experimentalValidationNeeded: true,
        disclaimer: 'test',
      },
    }

    expect(buildFinalizedProtocol(analysis, original)).toBe(original)
  })
})
