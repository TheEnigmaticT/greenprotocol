import { describe, expect, it } from 'vitest'
import {
  ACS_GCIPR_FRAMEWORK_DOI,
  ACS_GCIPR_FUNCTIONAL_GROUP_MEANING,
  acsReagentGuideCard,
  applyAcsGciprRecommendations,
  detectAcsReactionFamily,
  lookupAcsGciprSolvent,
} from '@/lib/acs-gcipr'
import { isEligibleToReviseProcedure } from '@/lib/recommendation-candidates'
import { buildFinalizedProtocol, canApplyAcceptedRecommendation } from '@/lib/finalized-protocol'
import type { AnalysisResult, AnalysisStep, Recommendation } from '@/lib/types'

function step(description: string, chemicals: AnalysisStep['chemicals'] = []): AnalysisStep {
  return {
    stepNumber: 1,
    description,
    chemicals,
    conditions: { temperature: null, duration: null, atmosphere: null },
  }
}

const dmf = { name: 'DMF', role: 'solvent', quantity: '5 mL', quantityMl: 5, quantityKg: null }

describe('ACS GCIPR solvent catalog', () => {
  function swap(chemical: string, alternative: string): Recommendation {
    return {
      stepNumber: 1,
      principleNumbers: [5],
      principleNames: ['Safer Solvents and Auxiliaries'],
      severity: 'low',
      original: { chemical, issue: `Possible replacement for ${chemical}.` },
      alternative: {
        chemical: alternative,
        rationale: 'placeholder',
        yieldImpact: 'Unknown',
        caveats: 'Suggestion only.',
        evidenceBasis: 'CHEM21 solvent catalogue. Deterministic scores stay separate.',
      },
      confidenceLevel: 'low',
      evidenceAssessment: {
        disposition: 'analogous_only',
        directness: 'indirect',
        supportingReferenceCount: 0,
        applicability: 'weak',
        eligibleForApplication: false,
        eligibilityReason: 'Catalogue only.',
      },
    }
  }

  it('flags DMF as Hazardous and writes a suggestion only when a replacement is already named', () => {
    const match = lookupAcsGciprSolvent({ name: 'DMF' })
    expect(match?.matchedOn).toBe('name')
    expect(match?.row.defaultRanking).toBe('Hazardous')
    expect(match?.row.adjustedRanking).toBe('Hazardous')
    expect(match?.row.avoidance).toBe('Y')
    expect(match?.row.ichClass).toBe('2')
    expect(match?.row.ichLimitPpm).toBe('880')

    expect(applyAcsGciprRecommendations({
      steps: [step('Heat the mixture in DMF.', [dmf])],
      recommendations: [],
    })).toEqual([])

    const [card] = applyAcsGciprRecommendations({
      steps: [step('Heat the mixture in DMF.', [dmf])],
      recommendations: [swap('DMF', 'acetonitrile')],
    })

    expect(card.alternative.chemical).toBe('acetonitrile')
    expect(card.alternative.rationale).toMatch(/Consider replacing DMF with acetonitrile/)
    expect(card.alternative.rationale).toMatch(/rates DMF \[N,N-Dimethylformamide\] Hazardous/)
    expect(card.alternative.rationale).toMatch(/not proof it works in this step/)
    expect(card.acsGcipr?.source).toBe('solvent_catalog')
    expect(card.acsGcipr?.revisesProcedure).toBe(false)
    expect(card.evidenceAssessment?.eligibleForApplication).toBe(false)
    expect(isEligibleToReviseProcedure(card.evidenceAssessment)).toBe(false)
    expect(card.evidence?.citations?.some(citation => citation.doi === ACS_GCIPR_FRAMEWORK_DOI)).toBe(true)
    expect(canApplyAcceptedRecommendation({ ...card, isAccepted: true })).toBe(false)
  })

  it('treats a functional-group Y flag as solvent identity, not reaction compatibility', () => {
    const match = lookupAcsGciprSolvent({ name: 'DMF', cas: '68-12-2', smiles: 'O=CN(C)C' })
    expect(match?.row.solventClasses).toContain('Amide')
    expect(match?.row.solventClasses).toContain('3°Amide')
    expect(ACS_GCIPR_FUNCTIONAL_GROUP_MEANING).toBe('solvent_identity_not_reaction_compatibility')

    const [card] = applyAcsGciprRecommendations({
      steps: [step('Dissolve the substrate in DMF.', [dmf])],
      recommendations: [swap('DMF', 'acetonitrile')],
    })
    expect(card.acsGcipr?.functionalGroupMeaning).toBe('solvent_identity_not_reaction_compatibility')
    expect(card.acsGcipr?.solvent?.solventClasses).toEqual(match?.row.solventClasses)
    expect(card.alternative.rationale.toLowerCase()).not.toMatch(/safe for (?:reactions containing )?amides/)
  })

  it('keeps default Recommended distinct from adjusted ranking and does not treat it as reaction-safe', () => {
    const dmso = lookupAcsGciprSolvent({ name: 'DMSO' })
    expect(dmso?.row.defaultRanking).toBe('Recommended')
    expect(dmso?.row.adjustedRanking).toBe('Problematic')
    const [card] = applyAcsGciprRecommendations({
      steps: [step('Use DMSO as the solvent.', [{ ...dmf, name: 'DMSO' }])],
      recommendations: [swap('DMSO', 'sulfolane')],
    })
    expect(card.alternative.rationale).toMatch(/default ranking for DMSO/)
    expect(card.alternative.rationale).toMatch(/Recommended/)
    expect(card.alternative.rationale).toMatch(/adjusted ranking is Problematic/)
    expect(card.alternative.rationale).toMatch(/not proof it works in this step/)
    expect(card.evidenceAssessment?.eligibleForApplication).toBe(false)
  })

  it('does not match partial or ambiguous names, and does not invent blank caveats', () => {
    expect(lookupAcsGciprSolvent({ name: 'amide' })).toBeNull()
    expect(lookupAcsGciprSolvent({ name: 'methylformamide' })).toBeNull()
    expect(lookupAcsGciprSolvent({ name: 'Formamide' })?.row.name).toBe('Formamide')
    expect(lookupAcsGciprSolvent({ name: 'DMI' })).toBeNull()
    expect(lookupAcsGciprSolvent({ name: 'Dimethyl isosorbide' })?.row.name).toContain('Dimethyl isosorbide')
    expect(lookupAcsGciprSolvent({ name: 'DMF', smiles: 'CS(=O)C' })).toBeNull()

    const dmfRow = lookupAcsGciprSolvent({ name: 'DMF' })?.row
    expect(dmfRow?.caveats.some(caveat => caveat.label === 'General notes')).toBe(false)
    expect(dmfRow?.caveats.some(caveat => caveat.label === 'Environmental notes')).toBe(true)
    expect(dmfRow?.caveats.some(caveat => caveat.text === 'Not assigned' || caveat.text === 'unknown')).toBe(false)
  })

  it('does not downgrade a recommendation another source already qualified', () => {
    const qualified: Recommendation = {
      stepNumber: 1,
      principleNumbers: [5],
      principleNames: ['Safer Solvents and Auxiliaries'],
      severity: 'medium',
      original: { chemical: 'DMF', issue: 'Direct evidence supports a swap' },
      alternative: {
        chemical: 'Ethyl acetate',
        rationale: 'Direct evidence',
        yieldImpact: 'Similar',
        caveats: 'Validate work-up.',
        evidenceBasis: 'Adjudicated literature',
      },
      confidenceLevel: 'high',
      evidenceAssessment: {
        disposition: 'supported_applicable',
        directness: 'direct',
        supportingReferenceCount: 2,
        applicability: 'strong',
        eligibleForApplication: true,
        eligibilityReason: 'Direct solvent-context evidence.',
      },
    }
    const [annotated] = applyAcsGciprRecommendations({
      steps: [step('Suzuki coupling in DMF.', [dmf])],
      recommendations: [qualified],
    })
    expect(annotated.evidenceAssessment).toMatchObject({
      disposition: 'supported_applicable',
      eligibleForApplication: true,
    })
    expect(annotated.alternative.chemical).toBe('Ethyl acetate')
    expect(annotated.acsGcipr?.source).toBe('solvent_catalog')
    expect(isEligibleToReviseProcedure(annotated.evidenceAssessment)).toBe(true)
  })
})

describe('ACS GCIPR reagent-guide citations', () => {
  it('emits a Suzuki supported_with_constraints card that does not change protocol text', () => {
    const protocol = 'Suzuki coupling of 4-bromoanisole with phenylboronic acid in dioxane.'
    const parsed = step(protocol, [{ ...dmf, name: '1,4-Dioxane' }])
    expect(detectAcsReactionFamily(protocol)).toBe('suzuki')
    const card = acsReagentGuideCard(parsed)
    expect(card).not.toBeNull()
    expect(card?.evidenceAssessment).toMatchObject({
      disposition: 'supported_with_constraints',
      eligibleForApplication: false,
    })
    expect(card?.acsGcipr?.reagentGuide?.guideUrl).toBe('https://reagents.acsgcipr.org/reagent-guides/suzuki-miyaura/')
    expect(card?.acsGcipr?.reagentGuide?.dois).toContain('10.1021/ja042491j')
    expect(card?.acsGcipr?.reagentGuide?.dois.every(doi => doi.startsWith('10.'))).toBe(true)
    expect(isEligibleToReviseProcedure(card?.evidenceAssessment)).toBe(false)
    expect(canApplyAcceptedRecommendation({ ...card!, isAccepted: true })).toBe(false)

    const analysis: AnalysisResult = {
      protocolTitle: 'Suzuki',
      chemistrySubdomain: 'cross-coupling',
      steps: [parsed],
      recommendations: [{ ...card!, isAccepted: true }],
      revisedProtocol: protocol,
      overallAssessment: {
        greenPrinciplesViolated: [],
        mostImpactfulChange: 'none',
        experimentalValidationNeeded: true,
        disclaimer: 'test',
      },
    }
    expect(buildFinalizedProtocol(analysis, protocol)).toBe(protocol)
  })

  it('emits a Buchwald-Hartwig citation card and stays silent when the family does not match', () => {
    const buchwald = acsReagentGuideCard(step('Buchwald-Hartwig amination of the aryl chloride with morpholine.'))
    expect(buchwald?.acsGcipr?.reagentGuide?.family).toBe('buchwald-hartwig')
    expect(buchwald?.acsGcipr?.reagentGuide?.guideUrl).toBe('https://reagents.acsgcipr.org/reagent-guides/buchwald-hartwig-amination/')
    expect(buchwald?.acsGcipr?.reagentGuide?.dois.length).toBeGreaterThan(0)
    expect(buchwald?.evidenceAssessment?.eligibleForApplication).toBe(false)

    const snar = acsReagentGuideCard(step('SNAr displacement of the aryl fluoride with the amine.'))
    expect(snar?.acsGcipr?.reagentGuide?.family).toBe('snar')
    expect(snar?.evidenceAssessment?.disposition).toBe('supported_with_constraints')

    expect(acsReagentGuideCard(step('Heat the ester in ethanol.'))).toBeNull()
    expect(detectAcsReactionFamily('Amide coupling with HATU.')).toBeNull()
  })
})

