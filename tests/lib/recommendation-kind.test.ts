import { describe, expect, it } from 'vitest'
import type { Recommendation } from '@/lib/types'
import { buildAssemblePrompt } from '@/lib/prompts/assemble'
import { buildFinalizedProtocol } from '@/lib/finalized-protocol'
import {
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
  it('passes only chemical_swap recommendations into assemble prompt payload', () => {
    const swap = makeRec({
      kind: 'chemical_swap',
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
