import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PrincipleSection from '@/components/PrincipleSection'
import type { PrincipleScore } from '@/lib/types'

function score(overrides: Partial<PrincipleScore>): PrincipleScore {
  return {
    principle_number: 5,
    principle_name: 'Safer Solvents and Auxiliaries',
    score: 5,
    max_score: 10,
    normalized: 0.5,
    details: {},
    chemicals_flagged: [],
    data_sources: ['chem21'],
    confidence: 'calculated',
    ...overrides,
  }
}

function markup(s: PrincipleScore | undefined) {
  return renderToStaticMarkup(createElement(PrincipleSection, {
    principleNumber: s?.principle_number ?? 5,
    principleName: s?.principle_name ?? 'Safer Solvents and Auxiliaries',
    score: s,
    recommendations: [],
  }))
}

describe('PrincipleSection coverage / role boundary', () => {
  it('labels AI-assessed scores with a visible AI marker, distinct from deterministic', () => {
    const html = markup(score({
      principle_number: 5,
      score: 6,
      confidence: 'model-inferred',
      data_sources: ['ai_assessment'],
    }))

    // AI label is visible — not silent
    expect(html).toMatch(/AI[- ]assessed|AI-?estimated|model[- ]inferred/i)
    // And the description text is honest about it
    expect(html).toMatch(/AI[- ]assessed score|AI assessment|AI-?assessed/i)
  })

  it('renders unavailable score without a numeric value', () => {
    const html = markup(score({
      principle_number: 5,
      score: -1,
      confidence: 'unavailable',
      details: { error: 'chem21 unavailable' },
    }))

    // No "−1" or "N/A" missing; "N/A" is the right representation, never "-1"
    expect(html).toMatch(/N\/A|n\/a/i)
    expect(html).not.toMatch(/>-1</)
  })

  it('respects role-aware solvent/use boundary: a use-role chemical is not labeled as a solvent', () => {
    // The component receives a PrincipleScore with flagged chemicals. For a solvent
    // principle (P5), flagged chemicals are solvent-flagged. For other principles
    // (e.g. P8 Reduce Derivatives) chemicals can be flagged for a different reason.
    // The component should NOT blanket-label all flagged chemicals on a non-solvent
    // principle as "solvent".
    const html = markup(score({
      principle_number: 8, // Reduce Derivatives — not a solvent principle
      score: 4,
      confidence: 'calculated',
      chemicals_flagged: ['sodium borohydride'], // reagent, not a solvent
    }))

    // Just shows the chemical under "Flagged Chemicals" — no implied solvent label
    expect(html).toContain('sodium borohydride')
    // No "solvent" label on this principle's flagged list
    expect(html).not.toMatch(/Flagged Chemicals[\s\S]{0,300}solvent/i)
  })
})
