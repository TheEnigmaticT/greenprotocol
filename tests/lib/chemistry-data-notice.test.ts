import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ChemistryDataNotice from '@/components/ChemistryDataNotice'

function markup(status: object) {
  return renderToStaticMarkup(createElement(ChemistryDataNotice, { status: status as never }))
}

describe('ChemistryDataNotice', () => {
  it('calls out an indefinite material by name when scoring still ran', () => {
    const html = markup({
      pending: false,
      deterministicScoringAvailable: true,
      unresolvedChemicals: [],
      indefiniteChemicals: ['brine'],
      message: 'Partial deterministic scoring completed.',
    })
    expect(html).toContain("We don&#x27;t know what brine is!")
    expect(html).toContain('We cannot treat mixtures or undefined compositions as a single chemical')
    expect(html).toContain('scoring skipped them')
    expect(html).not.toContain('Check the spelling')
    expect(html).not.toContain('Reference data missing')
  })

  it('calls out a name we could not identify, such as a typo', () => {
    const html = markup({
      pending: true,
      deterministicScoringAvailable: true,
      unresolvedChemicals: ['iranium'],
      indefiniteChemicals: [],
      message: 'Partial deterministic scoring completed.',
    })
    expect(html).toContain("We don&#x27;t know what iranium is!")
    expect(html).toContain('Check the spelling, or name it more precisely')
    expect(html).not.toContain('mixtures or undefined compositions')
    expect(html).not.toContain('Reference data missing')
    expect(html).not.toContain('Missing reference records')
  })

  it('keeps a service outage distinct from an unknown name', () => {
    const html = markup({
      pending: true,
      deterministicScoringAvailable: false,
      unresolvedChemicals: [],
      indefiniteChemicals: [],
      message: 'Deterministic chemistry scoring was unavailable because the chemistry service did not return a score.',
    })
    expect(html).toContain('Deterministic scoring unavailable')
    expect(html).not.toContain("We don&#x27;t know what")
  })
})
