/**
 * Layout checks on positioned PDF text. They never change the text; they only decide which
 * warnings the scientist should see ("this page may have two columns", "formulae lost their
 * subscripts"). Coordinates are PDF user space: y grows upward.
 */

export interface PdfTextItem {
  str: string
  x: number
  y: number
  width: number
  fontSize: number
}

export interface PageLayoutFindings {
  twoColumn: boolean
  table: boolean
  /** Subscript/superscript runs that were flattened onto the baseline (H2SO4, Fe3+, 10-3). */
  flattenedScripts: number
  /** U+FFFD or private-use characters: the font could not be mapped to real text. */
  garbledCharacters: number
}

interface Segment {
  x: number
  text: string
}

const MIN_COLUMN_LINES = 6
const MIN_TABLE_LINES = 3
const MIN_SEGMENT_CHARS = 3

/** Items that sit on the same baseline, left to right. */
function groupLines(items: PdfTextItem[]): PdfTextItem[][] {
  const visible = items.filter((item) => item.str.trim() !== '')
  const sorted = [...visible].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: PdfTextItem[][] = []
  for (const item of sorted) {
    const line = lines[lines.length - 1]
    if (line && Math.abs(line[0].y - item.y) <= Math.max(1, item.fontSize * 0.3)) line.push(item)
    else lines.push([item])
  }
  return lines.map((line) => line.sort((a, b) => a.x - b.x))
}

/** Splits a line where the horizontal gap is wider than about two and a half characters. */
function splitSegments(line: PdfTextItem[]): Segment[] {
  const segments: Segment[] = []
  let previousEnd = Number.NEGATIVE_INFINITY
  for (const item of line) {
    const gap = item.x - previousEnd
    const last = segments[segments.length - 1]
    if (last && gap <= item.fontSize * 2.5) last.text += item.str
    else segments.push({ x: item.x, text: item.str })
    previousEnd = item.x + item.width
  }
  return segments.map((segment) => ({ ...segment, text: segment.text.trim() }))
}

/** Largest group of x positions within `tolerance` of each other. */
function largestAlignedGroup(xs: number[], tolerance: number): number[] {
  const sorted = [...xs].sort((a, b) => a - b)
  let best: number[] = []
  let group: number[] = []
  for (const x of sorted) {
    if (group.length > 0 && x - group[0] > tolerance) group = group.filter((g) => x - g <= tolerance)
    group.push(x)
    if (group.length > best.length) best = [...group]
  }
  return best
}

function averageLength(segments: Segment[]): number {
  return segments.reduce((sum, segment) => sum + segment.text.length, 0) / segments.length
}

function findColumnsAndTables(items: PdfTextItem[]): Pick<PageLayoutFindings, 'twoColumn' | 'table'> {
  const lines = groupLines(items).map(splitSegments)
  if (lines.length === 0) return { twoColumn: false, table: false }

  const fontSize = items.reduce((max, item) => Math.max(max, item.fontSize), 0) || 10
  const tolerance = fontSize * 1.5

  // Lines made of exactly two substantial segments starting at a shared x: columns of prose or a two-column table.
  const twoSegmentLines = lines.filter(
    (segments) => segments.length === 2 && segments.every((s) => s.text.length >= MIN_SEGMENT_CHARS),
  )
  const sharedStarts = largestAlignedGroup(twoSegmentLines.map((segments) => segments[1].x), tolerance)
  let twoColumn = false
  let table = false
  if (sharedStarts.length >= MIN_COLUMN_LINES) {
    const aligned = twoSegmentLines.filter((segments) => Math.abs(segments[1].x - sharedStarts[0]) <= tolerance)
    const proseLike = averageLength(aligned.map((segments) => segments[0])) >= 20 && averageLength(aligned.map((segments) => segments[1])) >= 20
    if (proseLike) twoColumn = true
    else table = true
  }

  // Three or more cells per row, repeated: a table.
  const wideRows = lines.filter((segments) => segments.length >= 3 && segments.every((s) => s.text.length >= 1))
  if (wideRows.length >= MIN_TABLE_LINES) table = true

  return { twoColumn, table }
}

const ELEMENT_OR_BRACKET_END = /(?:\p{Lu}\p{Ll}?|[)\]])$/u
const SCRIPT_CHARS = /^(?:[0-9]{1,3}[+\-\u2212\u2013]?|[+\-\u2212\u2013][0-9]{0,2})$/

/** Counts small raised/lowered digit or charge runs sitting right after a formula-like or numeric token. */
function countFlattenedScripts(items: PdfTextItem[]): number {
  let count = 0
  let base: PdfTextItem | undefined
  for (const item of items) {
    const text = item.str.trim()
    if (text === '') continue
    if (base && item.fontSize < base.fontSize * 0.85 && SCRIPT_CHARS.test(text)) {
      const rise = item.y - base.y
      const offset = Math.abs(rise)
      const adjacent = item.x - (base.x + base.width) >= -base.fontSize * 0.2 && item.x - (base.x + base.width) <= base.fontSize * 0.8
      const baseText = base.str.trimEnd()
      const afterFormula = base.str === baseText && ELEMENT_OR_BRACKET_END.test(baseText)
      const afterNumber = rise > 0 && /\d$/.test(baseText)
      if (adjacent && offset >= base.fontSize * 0.1 && offset <= base.fontSize * 0.7 && (afterFormula || afterNumber)) {
        count += 1
      }
      continue
    }
    if (item.fontSize >= 6) base = item
  }
  return count
}

export function analyzePageLayout(items: PdfTextItem[]): PageLayoutFindings {
  const text = items.map((item) => item.str).join('')
  const privateUse = text.match(/[\uE000-\uF8FF]/g)?.length ?? 0
  const replacement = text.match(/\uFFFD/g)?.length ?? 0
  return {
    ...findColumnsAndTables(items),
    flattenedScripts: countFlattenedScripts(items),
    garbledCharacters: replacement + (privateUse >= 3 ? privateUse : 0),
  }
}

/** "page 2", "pages 2 and 5", "pages 1, 2, 3, 4, 5 and 2 more" */
export function formatPageList(pages: number[]): string {
  if (pages.length === 1) return `page ${pages[0]}`
  const shown = pages.slice(0, 5).map(String)
  const rest = pages.length - shown.length
  if (rest > 0) return `pages ${shown.join(', ')} and ${rest} more`
  return `pages ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

export function layoutWarnings(findings: PageLayoutFindings[]): string[] {
  const pagesWhere = (pick: (page: PageLayoutFindings) => boolean): number[] =>
    findings.flatMap((page, index) => (pick(page) ? [index + 1] : []))

  const warnings: string[] = []
  const columns = pagesWhere((page) => page.twoColumn)
  if (columns.length > 0) {
    warnings.push(`Possible two-column layout on ${formatPageList(columns)}. Check that the text reads in the right order.`)
  }
  const tables = pagesWhere((page) => page.table)
  if (tables.length > 0) {
    warnings.push(`Possible table on ${formatPageList(tables)}. Check that each value is still next to the right chemical, amount or unit.`)
  }
  const scripts = pagesWhere((page) => page.flattenedScripts > 0)
  if (scripts.length > 0) {
    warnings.push(`Subscripts, superscripts and charges are flattened in PDF text (on ${formatPageList(scripts)}), so formulae like H2SO4, Fe3+ or 10-3 lose their formatting. Check formulae and exponents.`)
  }
  const garbled = pagesWhere((page) => page.garbledCharacters > 0)
  if (garbled.length > 0) {
    warnings.push(`Some characters on ${formatPageList(garbled)} could not be read properly and appear as � or odd symbols. Check names, numbers and units there.`)
  }
  return warnings
}
