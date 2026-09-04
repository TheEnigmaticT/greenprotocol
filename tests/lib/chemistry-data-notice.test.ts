import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ChemistryDataNotice from '@/components/ChemistryDataNotice'

describe('ChemistryDataNotice', () => {
  it('uses a constructive explanation when an indefinite material did not block scoring', () => {
    const markup = renderToStaticMarkup(createElement(ChemistryDataNotice, {
      status: {
        pending: false,
        deterministicScoringAvailable: true,
        unresolvedChemicals: [],
        indefiniteChemicals: ['brine'],
        message: 'Partial deterministic scoring completed.',
      },
    }))

    expect(markup).toContain("We don&#x27;t know what brine is!")
    expect(markup).toContain('We scored everything we could')
    expect(markup).toContain('Your score may go up or down substantially if you specify brine more precisely and rerun this analysis.')
    expect(markup).not.toContain('Reference data missing')
    expect(markup).not.toContain('Indefinite materials: brine')
  })
})
