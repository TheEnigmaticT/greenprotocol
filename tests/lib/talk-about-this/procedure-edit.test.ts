import { describe, expect, it } from 'vitest'
import { MAX_PROTOCOL_CHARS } from '@/lib/protocol-limits'
import {
  MAX_EDIT_FIND_CHARS,
  MAX_EDIT_REPLACE_CHARS,
  MAX_PROCEDURE_EDITS,
  applyProcedureEdits,
  computeUnifiedDiff,
  hashProcedureText,
  normalizeProcedureText,
} from '@/lib/talk-about-this/procedure-edit'

const procedure = [
  '1. Dissolve the amine (2.0 g) in 20 mL DMF.',
  '2. Add EDC (1.2 equiv) and stir for 2 h at room temperature.',
  '3. Wash with 30 mL dichloromethane.',
  '4. Dry over sodium sulfate and concentrate.',
].join('\n')

function edit(find: string, replace: string) {
  return { find, replace, rationale: 'because' }
}

function failureOf(result: ReturnType<typeof applyProcedureEdits>) {
  if (result.ok) throw new Error('expected a failure')
  return result.failure
}

describe('applyProcedureEdits single-match discipline', () => {
  it('applies a find that occurs exactly once', () => {
    const result = applyProcedureEdits(procedure, [edit('20 mL DMF', '20 mL Cyrene')])

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.proposedText).toContain('Dissolve the amine (2.0 g) in 20 mL Cyrene.')
    expect(result.proposedText.split('\n')).toHaveLength(4)
  })

  it('rejects a find with zero matches and names the edit, so the model can correct it', () => {
    const failure = failureOf(applyProcedureEdits(procedure, [edit('20 mL DMF', '20 mL Cyrene'), edit('25 mL DMF', 'x')]))

    expect(failure).toMatchObject({ code: 'no_match', editIndex: 1 })
    expect(failure.message).toContain('Edit 2')
  })

  it('rejects a find that occurs more than once rather than guessing which one', () => {
    const failure = failureOf(applyProcedureEdits(procedure, [edit('mL', 'milliliters')]))

    expect(failure).toMatchObject({ code: 'ambiguous', editIndex: 0 })
  })

  it('counts overlapping occurrences as ambiguous', () => {
    expect(failureOf(applyProcedureEdits('aaa and then some more text here', [edit('aa', 'b')]))).toMatchObject({ code: 'ambiguous' })
  })

  it('is case sensitive', () => {
    expect(failureOf(applyProcedureEdits(procedure, [edit('20 ml dmf', 'x')]))).toMatchObject({ code: 'no_match' })
  })

  it('rejects an empty find', () => {
    expect(failureOf(applyProcedureEdits(procedure, [edit('', 'x')]))).toMatchObject({ code: 'empty_find' })
  })

  it('applies nothing when any edit fails', () => {
    const result = applyProcedureEdits(procedure, [edit('20 mL DMF', '20 mL Cyrene'), edit('missing text', 'x')])

    expect(result.ok).toBe(false)
  })
})

describe('applyProcedureEdits overlap and ordering', () => {
  it('rejects overlapping edits', () => {
    const failure = failureOf(applyProcedureEdits(procedure, [
      edit('in 20 mL DMF', 'in 20 mL Cyrene'),
      edit('20 mL DMF.', '25 mL Cyrene.'),
    ]))

    expect(failure.code).toBe('overlap')
    expect(failure.message).toContain('Edit 1 and edit 2')
  })

  it('allows touching edits and applies them regardless of the order the model listed them', () => {
    const result = applyProcedureEdits(procedure, [
      edit('sodium sulfate', 'magnesium sulfate'),
      edit('30 mL dichloromethane', '30 mL ethyl acetate'),
      edit('EDC (1.2 equiv)', 'EDC (1.5 equiv)'),
    ])

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.proposedText).toContain('EDC (1.5 equiv)')
    expect(result.proposedText).toContain('30 mL ethyl acetate')
    expect(result.proposedText).toContain('magnesium sulfate')
    expect(result.proposedText).not.toContain('dichloromethane')
  })

  it('supports deleting text with an empty replacement', () => {
    const result = applyProcedureEdits(procedure, [edit(' and stir for 2 h at room temperature', '')])

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.proposedText).toContain('2. Add EDC (1.2 equiv).')
  })
})

describe('applyProcedureEdits limits', () => {
  it('requires at least one edit and caps the number of edits', () => {
    expect(failureOf(applyProcedureEdits(procedure, []))).toMatchObject({ code: 'no_edits' })
    const many = Array.from({ length: MAX_PROCEDURE_EDITS + 1 }, () => edit('x', 'y'))
    expect(failureOf(applyProcedureEdits(procedure, many))).toMatchObject({ code: 'too_many_edits' })
  })

  it('caps find and replacement sizes', () => {
    expect(failureOf(applyProcedureEdits(procedure, [edit('x'.repeat(MAX_EDIT_FIND_CHARS + 1), 'y')]))).toMatchObject({ code: 'find_too_long' })
    expect(failureOf(applyProcedureEdits(procedure, [edit('20 mL DMF', 'y'.repeat(MAX_EDIT_REPLACE_CHARS + 1))]))).toMatchObject({ code: 'replace_too_long' })
  })

  it('rejects a result larger than the protocol limit shared with the analyze route', () => {
    const nearLimit = `${'a'.repeat(MAX_PROTOCOL_CHARS - 10)} MARKER end`
    const failure = failureOf(applyProcedureEdits(nearLimit, [edit('MARKER', 'x'.repeat(100))]))

    expect(failure.code).toBe('too_long')
    expect(failure.message).toContain('50,000')
  })

  it('accepts a result that lands exactly on the limit', () => {
    const text = `${'a'.repeat(MAX_PROTOCOL_CHARS - 7)} MARKER`
    const result = applyProcedureEdits(text, [edit('MARKER', 'DONE!!')])

    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.proposedText).toHaveLength(MAX_PROTOCOL_CHARS)
  })

  it('rejects an edit that would leave too little text to analyse', () => {
    expect(failureOf(applyProcedureEdits('Add the water and stir well.', [edit('Add the water and stir well.', 'Stir.')]))).toMatchObject({ code: 'too_short' })
  })

  it('rejects edits that change nothing', () => {
    expect(failureOf(applyProcedureEdits(procedure, [edit('20 mL DMF', '20 mL DMF')]))).toMatchObject({ code: 'no_change' })
  })
})

describe('applyProcedureEdits against the full saved text', () => {
  it('can edit text far beyond the 12,000-character chat snapshot', () => {
    const filler = Array.from({ length: 400 }, (_, index) => `Step ${index}: stir the mixture gently for 5 minutes.`).join('\n')
    const saved = `${filler}\nFinal step: wash with dichloromethane.`

    expect(saved.length).toBeGreaterThan(12_000)
    const result = applyProcedureEdits(saved, [edit('wash with dichloromethane', 'wash with ethyl acetate')])

    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.proposedText.endsWith('wash with ethyl acetate.')).toBe(true)
  })

  it('matches model finds written with plain newlines against pasted Windows line endings', () => {
    const saved = '1. Add the amine (2.0 g).\r\n2. Stir for 2 h at room temperature.\r\n3. Filter the mixture.'
    const result = applyProcedureEdits(saved, [edit('amine (2.0 g).\n2. Stir', 'amine (2.5 g).\n2. Stir')])

    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.proposedText).not.toContain('\r')
  })
})

describe('computeUnifiedDiff', () => {
  it('shows only the changed line with two lines of context and correct hunk numbers', () => {
    const before = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n')
    const after = before.replace('line 5', 'line five')

    expect(computeUnifiedDiff(before, after)).toBe([
      '@@ -3,5 +3,5 @@',
      ' line 3',
      ' line 4',
      '-line 5',
      '+line five',
      ' line 6',
      ' line 7',
    ].join('\n'))
  })

  it('emits separate hunks for distant edits and one hunk for nearby edits', () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n')
    const distant = before.replace('line 2\n', 'line two\n').replace('line 19', 'line nineteen')
    const near = before.replace('line 5\n', 'line five\n').replace('line 8\n', 'line eight\n')

    expect(computeUnifiedDiff(before, distant).match(/^@@/gm)).toHaveLength(2)
    expect(computeUnifiedDiff(before, near).match(/^@@/gm)).toHaveLength(1)
  })

  it('represents pure insertions and deletions', () => {
    expect(computeUnifiedDiff('a\nb', 'a\nnew\nb')).toContain('+new')
    expect(computeUnifiedDiff('a\nold\nb', 'a\nb')).toContain('-old')
  })

  it('produces a diff that reconstructs the new text when replayed on the old text', () => {
    const result = applyProcedureEdits(procedure, [edit('20 mL DMF', '20 mL Cyrene'), edit('30 mL dichloromethane', '30 mL ethyl acetate')])
    if (!result.ok) throw new Error('expected success')

    const replayed = result.diff.split('\n').filter(line => !line.startsWith('@@') && !line.startsWith('-')).map(line => line.slice(1))
    expect(replayed.join('\n')).toBe(result.proposedText)
  })
})

describe('hashProcedureText and normalizeProcedureText', () => {
  it('hashes the raw saved text so line-ending differences are visible', () => {
    expect(hashProcedureText('a\nb')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashProcedureText('a\nb')).not.toBe(hashProcedureText('a\r\nb'))
    expect(hashProcedureText('a\nb')).toBe(hashProcedureText('a\nb'))
  })

  it('normalizes CRLF and lone CR to LF', () => {
    expect(normalizeProcedureText('a\r\nb\rc')).toBe('a\nb\nc')
  })
})
