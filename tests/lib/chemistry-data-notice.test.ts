import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ChemistryDataNotice from '@/components/ChemistryDataNotice'

function markup(status: object, analysisId?: string) {
  return renderToStaticMarkup(createElement(ChemistryDataNotice, { status: status as never, analysisId }))
}

const base = { pending: true, deterministicScoringAvailable: true, unresolvedChemicals: [], indefiniteChemicals: [], message: 'stored text is not shown' }

describe('ChemistryDataNotice', () => {
  it('explains an unrecognised name by step, input and role, with what it means and what to do', () => {
    const html = markup({
      ...base,
      unresolvedChemicals: ['iranium'],
      unresolvedDetails: [{ name: 'iranium', reason: 'not_recognized', stepNumber: 3, role: 'solvent' }],
    })

    expect(html).toContain("1 material couldn&#x27;t be fully scored")
    expect(html).toContain('Step 3 · iranium · solvent')
    expect(html).toContain('known chemical')
    expect(html).toContain('your score could go up or down')
    expect(html).toContain('What to do:')
    expect(html).toContain('CAS number')
    expect(html).not.toContain("We don&#x27;t know what")
  })

  it('tells a temporary lookup failure apart from a name we do not recognise', () => {
    const html = markup({
      ...base,
      unresolvedChemicals: ['acetone', 'iranium'],
      unresolvedDetails: [
        { name: 'acetone', reason: 'provider_error', stepNumber: 2, role: 'solvent' },
        { name: 'iranium', reason: 'not_recognized', stepNumber: 3, role: 'reagent' },
      ],
    })

    expect(html).toContain("2 materials couldn&#x27;t be fully scored")
    expect(html).toContain('look this up just now')
    expect(html).toContain('Run the analysis again in a few minutes')
    expect(html).toContain('match this to a known chemical')
  })

  it('separates a record we could not retrieve from a name we could not match', () => {
    const html = markup({
      ...base,
      unresolvedChemicals: ['sodium triacetoxyborohydride'],
      unresolvedDetails: [{ name: 'sodium triacetoxyborohydride', reason: 'reference_missing', stepNumber: 4, role: 'reagent' }],
    })

    expect(html).toContain('reference record for this')
    expect(html).toContain('Add the CAS number')
    expect(html).not.toContain('match this to a known chemical')
  })

  it('explains a mixture and suggests naming its components', () => {
    const html = markup({
      ...base,
      pending: false,
      indefiniteChemicals: ['brine'],
      unresolvedDetails: [{ name: 'brine', reason: 'indefinite', stepNumber: 5, role: 'wash' }],
    })

    expect(html).toContain('Step 5 · brine · wash')
    expect(html).toContain('mixture')
    expect(html).toContain('sodium chloride and water instead of brine')
    expect(html).not.toContain('Indefinite')
  })

  it('still renders analyses saved before per-material reasons existed', () => {
    const html = markup({ ...base, unresolvedChemicals: ['iranium'], indefiniteChemicals: ['brine'] })

    expect(html).toContain("2 materials couldn&#x27;t be fully scored")
    expect(html).toContain('<li>iranium</li>')
    expect(html).toContain('<li>brine</li>')
  })

  it('offers a chat button only when the analysis has been saved', () => {
    const status = { ...base, unresolvedChemicals: ['iranium'] }

    expect(markup(status)).not.toContain('Chat about this')
    expect(markup(status, 'analysis-1')).toContain('Chat about this')
  })

  it('keeps a reference-data outage distinct from unknown materials and does not show stored wording', () => {
    const html = markup({
      ...base,
      deterministicScoringAvailable: false,
      message: 'Deterministic chemistry scoring was unavailable because the chemistry service did not return a score.',
    })

    expect(html).toContain('score this analysis against reference data')
    expect(html).not.toContain('Deterministic')
    expect(html).not.toContain("couldn&#x27;t be fully scored")
  })

  it('renders nothing when every material was scored', () => {
    expect(markup({ ...base, pending: false })).toBe('')
  })
})
