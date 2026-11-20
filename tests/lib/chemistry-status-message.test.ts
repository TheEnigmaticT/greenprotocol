import { describe, expect, it } from 'vitest'
import { buildChemistryStatusMessage } from '@/lib/chemistry-status-message'

describe('buildChemistryStatusMessage', () => {
  const messages = {
    unavailable: buildChemistryStatusMessage({ scoringAvailable: false, unresolvedCount: 3, indefiniteCount: 1 }),
    unresolved: buildChemistryStatusMessage({ scoringAvailable: true, unresolvedCount: 1, indefiniteCount: 1 }),
    indefinite: buildChemistryStatusMessage({ scoringAvailable: true, unresolvedCount: 0, indefiniteCount: 2 }),
    complete: buildChemistryStatusMessage({ scoringAvailable: true, unresolvedCount: 0, indefiniteCount: 0 }),
  }

  it('gives each situation its own wording, with unavailable scoring taking precedence', () => {
    expect(new Set(Object.values(messages)).size).toBe(4)
  })

  it('stays in plain language', () => {
    for (const message of Object.values(messages)) {
      expect(message).not.toMatch(/deterministic|indefinite|PubChem|queued|service did not/i)
    }
  })
})
