import { describe, expect, it } from 'vitest'
import { buildTalkAboutSystemPrompt } from '@/lib/talk-about-this/prompt'
import type { TalkAboutContext } from '@/lib/talk-about-this/context'

const context: TalkAboutContext = {
  schemaVersion: 1,
  analysisId: 'analysis-1',
  scope: { kind: 'recommendation', recommendationId: 'rec-1' },
  protocolTitle: 'Acid-base titration',
  protocolText: 'Add phenolphthalein to the titration flask.',
  steps: [{
    stepNumber: 3,
    description: 'Add phenolphthalein indicator.',
    chemicals: [],
    conditions: { temperature: null, duration: null, atmosphere: null },
  }],
  recommendations: [{
    id: 'rec-1',
    stepNumber: 3,
    principleNumbers: [3],
    principleNames: ['Less Hazardous Chemical Syntheses'],
    severity: 'medium',
    original: { chemical: 'phenolphthalein', issue: 'Suspected carcinogen' },
    alternative: {
      chemical: 'bromothymol blue',
      rationale: 'Avoids the flagged indicator.',
      yieldImpact: 'Validate endpoint compatibility.',
      caveats: 'Transition range differs.',
      evidenceBasis: 'Model inference',
    },
    confidenceLevel: 'medium',
  }],
  scores: [],
  citations: [],
  noDirectEvidence: true,
  contextHash: 'a'.repeat(64),
}

describe('buildTalkAboutSystemPrompt', () => {
  it('includes the frozen scoped facts the assistant must discuss', () => {
    const prompt = buildTalkAboutSystemPrompt(context)

    expect(prompt).toContain('phenolphthalein')
    expect(prompt).toContain('Suspected carcinogen')
    expect(prompt).toContain('bromothymol blue')
    expect(prompt).toContain('Add phenolphthalein to the titration flask.')
  })

  it('limits solvent safety and screening claims to returned evidence', () => {
    const prompt = buildTalkAboutSystemPrompt(context)

    expect(prompt).toContain('recommendation: "laboratory_screening"')
    expect(prompt).toContain('returned replacement relation names the candidate')
    expect(prompt).toContain('missing GHS information as unknown, never safe')
    expect(prompt).toContain('Measurements do not demonstrate reaction performance')
  })
})
