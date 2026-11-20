import { describe, expect, it } from 'vitest'
import { safeReturnTo } from '@/lib/auth-return'

describe('safe auth return targets', () => {
  it('keeps the private SciSure connector route but rejects external and protocol-relative URLs', () => {
    expect(safeReturnTo('/integrations/scisure/connect', '/dashboard')).toBe('/integrations/scisure/connect')
    expect(safeReturnTo('https://attacker.test', '/dashboard')).toBe('/dashboard')
    expect(safeReturnTo('//attacker.test', '/dashboard')).toBe('/dashboard')
  })
})
