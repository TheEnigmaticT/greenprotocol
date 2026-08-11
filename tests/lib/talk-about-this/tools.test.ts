import { describe, expect, it } from 'vitest'
import { buildChatTools } from '@/lib/talk-about-this/tools'
import type { TalkAboutContext } from '@/lib/talk-about-this/context'

const context = {
  schemaVersion: 1,
  analysisId: 'analysis-1',
  scope: { kind: 'recommendation', recommendationId: 'rec-1' },
  protocolTitle: 'Suzuki coupling',
  protocolText: 'Use DMF with phenylboronic acid.',
  steps: [{ stepNumber: 1, description: 'Use DMF.', chemicals: [{ name: 'DMF', role: 'solvent' }], conditions: {} }],
  recommendations: [{
    id: 'rec-1', stepNumber: 1, principleNumbers: [5], principleNames: ['Safer Solvents'], severity: 'high',
    original: { chemical: 'DMF', issue: 'Hazardous solvent' },
    alternative: { chemical: 'Cyrene', rationale: 'Lower hazard', yieldImpact: 'Validate', caveats: 'Viscosity', evidenceBasis: 'CHEM21' },
    confidenceLevel: 'medium',
  }],
  scores: [], citations: [], noDirectEvidence: true, contextHash: 'a'.repeat(64),
} satisfies TalkAboutContext

describe('buildChatTools', () => {
  it('limits chemistry tool arguments to frozen context chemicals', () => {
    const tools = buildChatTools(context)
    const chemicals = tools[0].function.parameters.properties.chemical.enum

    expect(chemicals).toEqual(expect.arrayContaining(['DMF', 'Cyrene']))
    expect(chemicals).not.toContain('benzene')
  })
})
