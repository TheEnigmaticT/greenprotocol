import { describe, expect, it } from 'vitest'
import { displayChemicalName, formatChemicalText } from '@/lib/chemical-display'

describe('displayChemicalName', () => {
  it('expands the DMF chemical label to N,N-Dimethylformamide', () => {
    expect(displayChemicalName('DMF')).toBe('N,N-Dimethylformamide')
  })

  it('leaves other chemical labels unchanged', () => {
    expect(displayChemicalName('DMSO')).toBe('DMSO')
  })
})

describe('formatChemicalText', () => {
  it('expands standalone DMF references in user-facing recommendation text', () => {
    expect(formatChemicalText('Replace DMF with DMSO.')).toBe('Replace N,N-Dimethylformamide with DMSO.')
  })

  it('does not alter a longer identifier containing DMF', () => {
    expect(formatChemicalText('DMFA is not DMF.')).toBe('DMFA is not N,N-Dimethylformamide.')
  })
})
