import { describe, expect, it } from 'vitest'
import {
  buildClarificationRequest,
  clarificationChemicals,
  describeMaterial,
  groupUnknownMaterials,
} from '@/lib/chemistry-unknowns'
import type { ChemistryDataStatus } from '@/lib/types'

function status(overrides: Partial<ChemistryDataStatus>): ChemistryDataStatus {
  return { pending: true, deterministicScoringAvailable: true, unresolvedChemicals: [], indefiniteChemicals: [], message: '', ...overrides }
}

describe('groupUnknownMaterials', () => {
  it('groups by reason, ordered by how fixable the problem is, and merges repeated steps', () => {
    const groups = groupUnknownMaterials(status({
      unresolvedChemicals: ['iranium', 'Boron trifloride'],
      indefiniteChemicals: ['brine'],
      unresolvedDetails: [
        { name: 'brine', reason: 'indefinite', stepNumber: 4, role: 'wash' },
        { name: 'iranium', reason: 'not_recognized', stepNumber: 5, role: 'solvent' },
        { name: 'Boron trifloride', reason: 'provider_error', stepNumber: 2, role: 'catalyst' },
        { name: 'iranium', reason: 'not_recognized', stepNumber: 2, role: 'solvent' },
      ],
    }))

    expect(groups.map(g => g.reason)).toEqual(['not_recognized', 'provider_error', 'indefinite'])
    expect(groups[0].materials).toEqual([{ name: 'iranium', steps: [2, 5], roles: ['solvent'] }])
  })

  it('falls back to the plain name lists for analyses saved before reasons were recorded', () => {
    const groups = groupUnknownMaterials(status({ unresolvedChemicals: ['iranium'], indefiniteChemicals: ['brine'] }))

    expect(groups).toEqual([
      { reason: 'unspecified', materials: [{ name: 'iranium', steps: [], roles: [] }] },
      { reason: 'indefinite', materials: [{ name: 'brine', steps: [], roles: [] }] },
    ])
  })

  it('lists a name once even when it appears in both lists with different case', () => {
    const groups = groupUnknownMaterials(status({ unresolvedChemicals: ['Brine '], indefiniteChemicals: ['brine'] }))
    expect(groups.flatMap(g => g.materials.map(m => m.name))).toEqual(['brine'])
  })

  it('has nothing to say when every material was scored', () => {
    expect(groupUnknownMaterials(status({ pending: false }))).toEqual([])
  })
})

describe('describeMaterial', () => {
  it('names the step, the material and its role', () => {
    expect(describeMaterial({ name: 'iranium', steps: [2, 5], roles: ['solvent'] })).toBe('Steps 2 and 5 · iranium · solvent')
    expect(describeMaterial({ name: 'brine', steps: [], roles: [] })).toBe('brine')
  })
})

describe('chat hand-off', () => {
  it('keeps the chemicals within the limits the chat endpoint accepts', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ name: `  compound-${i}${'x'.repeat(i === 0 ? 200 : 0)} `, steps: [1], roles: [] }))
    const chemicals = clarificationChemicals([{ reason: 'not_recognized', materials: many }])

    expect(chemicals).toHaveLength(10)
    expect(chemicals.every(name => name === name.trim() && name.length <= 120)).toBe(true)
  })

  it('composes a first message that names each material, where it is, and why it was not scored', () => {
    const message = buildClarificationRequest(groupUnknownMaterials(status({
      unresolvedChemicals: ['iranium'],
      indefiniteChemicals: ['brine'],
      unresolvedDetails: [
        { name: 'iranium', reason: 'not_recognized', stepNumber: 3, role: 'solvent' },
        { name: 'brine', reason: 'indefinite', stepNumber: 5 },
      ],
    })))

    expect(message).toContain("- iranium (step 3, solvent) wasn't matched to a known chemical")
    expect(message).toContain('- brine (step 5) is a mixture or has no fixed composition')
  })
})
