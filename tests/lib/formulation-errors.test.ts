import { describe, expect, it } from 'vitest'
import { humanizeError } from '@/lib/errors/humanize'

describe('formulation scope guidance', () => {
  it('asks the scientist to separate formulations, not retry the unchanged input', () => {
    const error = humanizeError({ code: 'ambiguous_formulations' })
    expect(error.code).toBe('ambiguous_formulations')
    expect(error.action).toBe('edit-protocol')
    expect(error.message).toMatch(/one formulation at a time/i)
    expect(error.message).toMatch(/no.*combined.*score/i)
  })
})
