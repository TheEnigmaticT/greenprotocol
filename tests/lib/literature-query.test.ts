import { describe, expect, it } from 'vitest'
import { boundLiteratureQuery } from '@/lib/literature-query'

describe('internally generated research queries', () => {
  it('preserves a short query verbatim', () => {
    expect(boundLiteratureQuery('Pd(PPh3)4 versus Pd/C')).toBe('Pd(PPh3)4 versus Pd/C')
  })
  it('bounds verbose model prose to the existing 500-character API contract', () => {
    const prefix = 'Green chemistry alternative for Pd(PPh3)4: Pd/C. '
    const result = boundLiteratureQuery(prefix + 'Detailed rationale. '.repeat(100))
    expect(result).toHaveLength(500)
    expect(result.startsWith(prefix)).toBe(true)
  })
})
