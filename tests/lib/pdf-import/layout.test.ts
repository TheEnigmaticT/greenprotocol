import { describe, expect, it } from 'vitest'
import { analyzePageLayout, formatPageList, layoutWarnings, type PdfTextItem } from '@/lib/pdf-import/layout'

const CHAR_WIDTH = 5

function item(str: string, x: number, y: number, fontSize = 10): PdfTextItem {
  return { str, x, y, width: str.length * CHAR_WIDTH * (fontSize / 10), fontSize }
}

/** One text line per entry, each split into positioned cells: [[x, text], ...]. */
function page(rows: Array<Array<[number, string]>>): PdfTextItem[] {
  return rows.flatMap((cells, row) => cells.map(([x, text]) => item(text, x, 700 - row * 14)))
}

const PROSE_LEFT = 'The flask was charged with toluene and heated'
const PROSE_RIGHT = 'A vial was charged with acetonitrile and stirred'

describe('analyzePageLayout: columns and tables', () => {
  it('flags a page where prose sits in two aligned columns', () => {
    const rows = Array.from({ length: 8 }, (): Array<[number, string]> => [[60, PROSE_LEFT], [320, PROSE_RIGHT]])
    expect(analyzePageLayout(page(rows))).toMatchObject({ twoColumn: true, table: false })
  })

  it('flags a table when rows have several short cells', () => {
    const rows: Array<Array<[number, string]>> = [
      [[60, 'Reagent'], [200, 'Amount'], [320, 'Equiv.']],
      [[60, 'Benzoic acid'], [200, '1.22 g'], [320, '1.0']],
      [[60, 'Benzylamine'], [200, '1.18 g'], [320, '1.1']],
      [[60, 'EDC'], [200, '2.30 g'], [320, '1.2']],
    ]
    expect(analyzePageLayout(page(rows))).toMatchObject({ table: true, twoColumn: false })
  })

  it('flags a two-column table of short cells as a table, not as columns of prose', () => {
    const rows = Array.from({ length: 7 }, (_, i): Array<[number, string]> => [[60, `Reagent ${i}`], [250, `${i + 1}.0 mmol`]])
    expect(analyzePageLayout(page(rows))).toMatchObject({ table: true, twoColumn: false })
  })

  it('does not flag ordinary single-column procedure text', () => {
    const rows = Array.from({ length: 12 }, (_, i): Array<[number, string]> => [[72, `${i + 1}. Stir the mixture at room temperature for ${i + 5} min.`]])
    expect(analyzePageLayout(page(rows))).toMatchObject({ twoColumn: false, table: false })
  })

  it('does not mistake a numbered-list marker or bullet separated by a wide gap for a column', () => {
    const rows = Array.from({ length: 8 }, (_, i): Array<[number, string]> => [[60, `${i + 1}.`], [110, 'Stir the mixture at room temperature.']])
    expect(analyzePageLayout(page(rows))).toMatchObject({ twoColumn: false, table: false })
  })

  it('needs enough rows before it raises a layout warning', () => {
    const rows = Array.from({ length: 3 }, (): Array<[number, string]> => [[60, PROSE_LEFT], [320, PROSE_RIGHT]])
    expect(analyzePageLayout(page(rows))).toMatchObject({ twoColumn: false })
  })

  it('handles an empty page', () => {
    expect(analyzePageLayout([])).toEqual({ twoColumn: false, table: false, flattenedScripts: 0, garbledCharacters: 0 })
  })
})

describe('analyzePageLayout: lost sub/superscripts', () => {
  const script = (str: string, x: number, y: number) => item(str, x, y, 6.5)

  it('counts subscript digits that were flattened into a formula', () => {
    const items = [
      item('Add aqueous H', 72, 600),
      script('2', 72 + 13 * CHAR_WIDTH, 597),
      item('SO', 72 + 13 * CHAR_WIDTH + 3, 600),
      script('4', 72 + 15 * CHAR_WIDTH + 6, 597),
    ]
    expect(analyzePageLayout(items).flattenedScripts).toBe(2)
  })

  it('counts a superscript charge after a metal symbol', () => {
    const items = [item('traces of Fe', 72, 600), script('3+', 72 + 12 * CHAR_WIDTH, 604)]
    expect(analyzePageLayout(items).flattenedScripts).toBe(1)
  })

  it('counts a raised exponent after a number (10-3)', () => {
    const items = [item('c = 10', 72, 600), script('-3', 72 + 6 * CHAR_WIDTH, 604)]
    expect(analyzePageLayout(items).flattenedScripts).toBe(1)
  })

  it('ignores a raised footnote number after an ordinary word', () => {
    const items = [item('as previously reported', 72, 600), script('12', 72 + 22 * CHAR_WIDTH, 604)]
    expect(analyzePageLayout(items).flattenedScripts).toBe(0)
  })

  it('ignores same-size digits and digits on the same baseline', () => {
    const items = [item('Add H', 72, 600), item('2', 72 + 5 * CHAR_WIDTH, 600), script('2', 72 + 6 * CHAR_WIDTH, 600)]
    expect(analyzePageLayout(items).flattenedScripts).toBe(0)
  })
})

describe('analyzePageLayout: garbled characters', () => {
  it('counts replacement characters', () => {
    expect(analyzePageLayout([item('25 \uFFFDC, 5 \uFFFDL', 72, 600)]).garbledCharacters).toBe(2)
  })

  it('counts private-use glyphs only when there are several', () => {
    expect(analyzePageLayout([item('\uE001\uE002\uE003\uE004 text', 72, 600)]).garbledCharacters).toBe(4)
    expect(analyzePageLayout([item('one \uE001 symbol', 72, 600)]).garbledCharacters).toBe(0)
  })
})

describe('formatPageList', () => {
  it.each([
    [[3], 'page 3'],
    [[2, 5], 'pages 2 and 5'],
    [[1, 2, 3], 'pages 1, 2 and 3'],
    [[1, 2, 3, 4, 5, 6, 7], 'pages 1, 2, 3, 4, 5 and 2 more'],
  ])('%j -> %s', (pages, expected) => {
    expect(formatPageList(pages)).toBe(expected)
  })
})

describe('layoutWarnings', () => {
  const quiet = { twoColumn: false, table: false, flattenedScripts: 0, garbledCharacters: 0 }

  it('is empty when nothing is suspicious', () => {
    expect(layoutWarnings([quiet, quiet])).toEqual([])
  })

  it('names the pages and speaks in plain language', () => {
    const warnings = layoutWarnings([quiet, { ...quiet, twoColumn: true }, { ...quiet, table: true, garbledCharacters: 2 }, { ...quiet, flattenedScripts: 1 }])
    expect(warnings).toHaveLength(4)
    expect(warnings[0]).toContain('two-column layout on page 2')
    expect(warnings[1]).toContain('table on page 3')
    expect(warnings[2]).toContain('page 4')
    expect(warnings[3]).toContain('page 3')
    expect(warnings.join(' ')).not.toMatch(/undefined|NaN|\[object/)
  })
})
