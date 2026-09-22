import { describe, expect, it } from 'vitest'
import { cleanChemicalName, normalizeParsedMaterials } from '@/lib/material-names'
import type { AnalysisStep, ParsedChemical } from '@/lib/types'

function chem(name: string, role = 'reagent', quantity = ''): ParsedChemical {
  return { name, role, quantity, quantityMl: null, quantityKg: null }
}

function step(chemicals: ParsedChemical[]): AnalysisStep[] {
  return [{
    stepNumber: 1,
    description: 'test',
    chemicals,
    conditions: { temperature: null, duration: null, atmosphere: null },
  }]
}

describe('material names', () => {
  it('strips procedure adjectives and expands lab shorthand', () => {
    expect(cleanChemicalName('cold distilled water')).toBe('water')
    expect(cleanChemicalName('conc. HCl')).toBe('hydrochloric acid')
    expect(cleanChemicalName('HCl solution')).toBe('hydrochloric acid')
    expect(cleanChemicalName('NaNO2 solution')).toBe('sodium nitrite')
    expect(cleanChemicalName('nitrous acid mixture')).toBe('nitrous acid')
    expect(cleanChemicalName('acetic acid (glacial)')).toBe('acetic acid')
    expect(cleanChemicalName('water (cold)')).toBe('water')
    expect(cleanChemicalName('glacial acetic acid')).toBe('acetic acid')
    expect(cleanChemicalName('dry ice')).toBe('dry ice')
    expect(cleanChemicalName('Jacobsencatalyst')).toBe('Jacobsen catalyst')
  })

  it('splits a slash pair, drops a test paper, and drops a generic product phrase', () => {
    const steps = normalizeParsedMaterials(step([
      chem('aniline/HCl', 'substrate', '5 mL'),
      chem('starch-iodide paper', 'other'),
      chem('diazonium salt solution', 'product'),
      chem('4-methoxybiphenyl', 'product'),
    ]))
    const names = steps[0].chemicals.map(item => `${item.role}:${item.name}`)
    expect(names).toEqual([
      'substrate:aniline',
      'reagent:hydrochloric acid',
      'product:diazonium salt',
      'product:4-methoxybiphenyl',
    ])
    expect(steps[0].chemicals[0].quantity).toBe('5 mL')
    expect(steps[0].chemicals[1].quantity).toBe('')
  })

  it('does not split a numbered eluent ratio', () => {
    const steps = normalizeParsedMaterials(step([chem('hexane/ethyl acetate 9:1', 'solvent')]))
    expect(steps[0].chemicals.map(item => item.name)).toEqual(['hexane/ethyl acetate 9:1'])
  })

  it('does not split stereo labels like L-(+)-tartaric acid', () => {
    const steps = normalizeParsedMaterials(step([
      chem('L-(+)-Tartaric acid', 'reagent'),
      chem('aniline + HCl', 'substrate', '5 mL'),
    ]))
    const names = steps[0].chemicals.map(item => item.name)
    expect(names).toEqual(['L-(+)-Tartaric acid', 'aniline', 'hydrochloric acid'])
  })
})
