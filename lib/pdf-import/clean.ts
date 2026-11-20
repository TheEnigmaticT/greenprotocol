import { MIN_PAGE_TEXT_CHARS } from './errors'

/**
 * Pure text cleanup for PDF-extracted procedures.
 *
 * Principles: never change a number, unit, chemical name or the order of the text.
 * Every transformation needs positive evidence; when a case is ambiguous the text is
 * left exactly as extracted. The scientist reviews the result before analysis.
 */

const LIGATURES: Record<string, string> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st',
}

/**
 * Chemistry prefixes and common compound heads whose trailing hyphen is part of the word.
 * "tert-\nbutyl" must stay "tert-butyl"; "room-\ntemperature" must stay "room-temperature".
 */
const HYPHEN_KEEP_HEADS: Record<string, true> = {
  tert: true, sec: true, cis: true, trans: true, anti: true, syn: true, endo: true, exo: true,
  meso: true, rac: true, rel: true, ortho: true, meta: true, para: true, non: true, semi: true,
  self: true, well: true, high: true, low: true, room: true, ice: true, oven: true, flame: true,
  air: true, water: true, round: true, flat: true, cold: true, hot: true, co: true, pre: true, post: true,
}

/** Lines at this fraction of the page's typical line width (or wider) are taken to be wrapped. */
const WRAP_RATIO = 0.7
const SOFT_WRAP_RATIO = 0.5

const PAGE_MARKER_LINE = /^\[p\. \d+(?::[^\]\n]*)?\]$/

/** Characters only: whitespace variants, ligatures, soft hyphens, control characters. Digits and letters are untouched. */
export function normalizeCharacters(text: string): string {
  return text
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .replace(/[\uFB00-\uFB06]/g, (char) => LIGATURES[char])
    .replace(/\u00AD(?=[ \t]*(?:\n|$))/g, '-')
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\t\u000B\u000C\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u0000-\u0008\u000E-\u001F\u007F]/g, '')
}

export function splitCleanLines(text: string): string[] {
  return normalizeCharacters(text)
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim())
}

const STEP_OR_LIST_START = new RegExp(
  '^(?:' +
    [
    String.raw`\d{1,3}[.)]\s`, // "1. " "2) "
    String.raw`\(\d{1,3}\)\s`, // "(3) "
    String.raw`Steps?\s*\d+`, // "Step 2" "Step 2:"
    String.raw`[a-z][.)]\s+(?=[A-Z])`, // "a) Add" "b. Stir"
    String.raw`[ivx]{1,4}[.)]\s`, // "iv. "
    String.raw`[-\u2013\u2014\u2022\u25CF\u25AA\u25E6\u2023\u2043*]\s+\S`, // bullets
    ].join('|') +
    ')',
)

const SECTION_HEADING_START =
  /^(?:(?:General|Typical|Representative|Standard) [Pp]rocedures?\b|Procedures?\b|Experimental\b|Synthesis of\b|Preparation of\b|Method [A-Z0-9]\b|Notes?\s*:?$|Materials\b|Reagents\b)/

/** True when a line begins a new step, list item or section, so it must not be joined to the line above. */
export function startsNewBlock(line: string): boolean {
  const trimmed = line.trimStart()
  return STEP_OR_LIST_START.test(trimmed) || SECTION_HEADING_START.test(trimmed)
}

// ---------------------------------------------------------------------------
// Running headers, footers, page numbers
// ---------------------------------------------------------------------------

const EXPLICIT_PAGE_NUMBER = /^(?:page\s+\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?|\d{1,4}\s*(?:of|\/)\s*\d{1,4}|[-\u2013\u2014]\s*\d{1,4}\s*[-\u2013\u2014])$/i
const BARE_NUMBER = /^\d{1,4}$/

function edgeLineIndexes(lines: string[], minLines: number): number[] {
  const filled = lines.flatMap((line, index) => (line ? [index] : []))
  if (filled.length < minLines) return []
  // Short pages have no room for a header and footer plus body: only their very first/last line counts.
  const width = filled.length >= 6 ? 2 : 1
  return [...new Set([...filled.slice(0, width), ...filled.slice(-width)])]
}

function furnitureKey(line: string): string {
  return line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ')
}

export interface PageFurnitureResult {
  pages: string[][]
  removed: string[]
}

/**
 * Removes (a) bare page numbers that form a consistent sequence across pages or use an
 * explicit "Page 3 of 12" form, and (b) running headers/footers: the same text (ignoring
 * digits) at the top or bottom of at least three pages and at least half of them.
 */
export function removePageFurniture(pages: string[][]): PageFurnitureResult {
  const removeAt: Set<number>[] = pages.map(() => new Set<number>())

  // Page numbers
  const offsetVotes: Record<number, number> = {}
  pages.forEach((lines, pageIndex) => {
    for (const index of edgeLineIndexes(lines, 2)) {
      const line = lines[index]
      if (EXPLICIT_PAGE_NUMBER.test(line)) removeAt[pageIndex].add(index)
      else if (BARE_NUMBER.test(line)) {
        const offset = Number(line) - (pageIndex + 1)
        offsetVotes[offset] = (offsetVotes[offset] ?? 0) + 1
      }
    }
  })
  const topOffset = Object.entries(offsetVotes).sort((a, b) => b[1] - a[1])[0]
  if (topOffset && topOffset[1] >= 2) {
    const offset = Number(topOffset[0])
    pages.forEach((lines, pageIndex) => {
      for (const index of edgeLineIndexes(lines, 2)) {
        if (BARE_NUMBER.test(lines[index]) && Number(lines[index]) - (pageIndex + 1) === offset) {
          removeAt[pageIndex].add(index)
        }
      }
    })
  }

  // Running headers and footers
  const pagesByKey: Record<string, number[]> = {}
  pages.forEach((lines, pageIndex) => {
    for (const index of edgeLineIndexes(lines, 3)) {
      const line = lines[index]
      if (line.length > 150 || startsNewBlock(line)) continue
      const key = furnitureKey(line)
      if (!/[a-z]/.test(key)) continue
      ;(pagesByKey[key] ??= []).push(pageIndex)
    }
  })
  const minPages = Math.max(3, Math.ceil(pages.length / 2))
  pages.forEach((lines, pageIndex) => {
    for (const index of edgeLineIndexes(lines, 3)) {
      const key = furnitureKey(lines[index])
      const seenOn = pagesByKey[key]
      if (seenOn && new Set(seenOn).size >= minPages) removeAt[pageIndex].add(index)
    }
  })

  const removed: string[] = []
  const kept = pages.map((lines, pageIndex) =>
    lines.filter((line, index) => {
      if (!removeAt[pageIndex].has(index)) return true
      removed.push(line)
      return false
    }),
  )
  return { pages: kept, removed }
}

// ---------------------------------------------------------------------------
// Hyphenation and reflow
// ---------------------------------------------------------------------------

export function collectWords(lines: string[]): Set<string> {
  const words = new Set<string>()
  for (const line of lines) {
    for (const token of line.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? []) words.add(token)
  }
  return words
}

type HyphenDecision = 'drop' | 'keep' | null

/**
 * Decides what a hyphen at the end of `prev` means when `next` continues it:
 * - null: `prev` does not end with a wrap hyphen at all.
 * - 'drop': typesetting hyphen inside an ordinary word ("tem-\nperature" -> "temperature").
 * - 'keep': the hyphen belongs to the name ("N-\nmethyl", "tert-\nbutyl", "1,2-\ndichloro").
 * Ambiguous compounds use the rest of the document as evidence for which spelling the author uses.
 */
function hyphenDecision(prev: string, next: string, words: Set<string>): HyphenDecision {
  const lastToken = prev.slice(prev.lastIndexOf(' ') + 1)
  if (lastToken.length < 2 || !lastToken.endsWith('-') || lastToken.endsWith('--')) return null

  const stem = lastToken.slice(0, -1)
  const nextWord = /^\p{Ll}+/u.exec(next)?.[0]
  const tail = /\p{Ll}{2,}$/u.exec(stem)?.[0]
  if (!nextWord || !tail) return 'keep'

  const before = stem.slice(0, stem.length - tail.length)
  if (!/(?:^|[^\p{L}\p{N}])\p{Lu}?$|-$/u.test(before)) return 'keep'
  if (HYPHEN_KEEP_HEADS[tail.toLowerCase()]) return 'keep'

  const word = stem.replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase()
  if (words.has(`${word}-${nextWord}`)) return 'keep'
  return 'drop'
}

function percentile90(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]
}

function shouldMerge(prev: string, next: string, fullWidth: number, words: Set<string>): boolean {
  if (startsNewBlock(next)) return false
  if (hyphenDecision(prev, next, words) !== null) return true
  if (prev.length >= WRAP_RATIO * fullWidth) return true
  return prev.length >= SOFT_WRAP_RATIO * fullWidth && !/[.!?:;]$/.test(prev) && /^\p{Ll}/u.test(next)
}

/** Joins hard-wrapped lines of one page into paragraphs. Blank lines, steps, bullets and headings stay put. */
export function reflowLines(lines: string[], words: Set<string>): string[] {
  const lengths = lines.filter(Boolean).map((line) => line.length)
  if (lengths.length === 0) return []
  const fullWidth = lengths.length < 4 ? Math.max(...lengths) : percentile90(lengths)

  const out: string[] = []
  let current = ''
  let previousPhysical = ''
  for (const line of lines) {
    if (!line) {
      if (current) out.push(current)
      if (out.length > 0 && out[out.length - 1] !== '') out.push('')
      current = ''
      previousPhysical = ''
      continue
    }
    if (current && shouldMerge(previousPhysical, line, fullWidth, words)) {
      const decision = hyphenDecision(previousPhysical, line, words)
      if (decision === 'drop') current = current.slice(0, -1) + line
      else if (decision === 'keep') current += line
      else current += ` ${line}`
    } else {
      if (current) out.push(current)
      current = line
    }
    previousPhysical = line
  }
  if (current) out.push(current)
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out
}

export interface CleanedPdfPages {
  /** Cleaned text of each page, without page markers. */
  pages: string[]
  /** Running headers, footers and page numbers that were dropped, for transparency. */
  removedLines: string[]
}

export function cleanPdfPages(rawPages: string[]): CleanedPdfPages {
  const furniture = removePageFurniture(rawPages.map(splitCleanLines))
  const words = collectWords(furniture.pages.flat())
  return {
    pages: furniture.pages.map((lines) => reflowLines(lines, words).join('\n')),
    removedLines: furniture.removed,
  }
}

// ---------------------------------------------------------------------------
// Page markers
// ---------------------------------------------------------------------------

export function hasPageText(pageText: string): boolean {
  return pageText.trim().length >= MIN_PAGE_TEXT_CHARS
}

/**
 * Joins cleaned pages with a visible "[p. N]" marker so the scientist can trace text back to its
 * source page. A single-page PDF gets no marker. Pages with no usable text are flagged in place.
 */
export function assemblePages(pages: string[]): string {
  if (pages.length === 1) return pages[0].trim()
  return pages
    .map((page, index) => {
      const marker = hasPageText(page) ? `[p. ${index + 1}]` : `[p. ${index + 1}: no text found on this page]`
      return page.trim() ? `${marker}\n${page.trim()}` : marker
    })
    .join('\n\n')
}

/** Removes the markers added by assemblePages. For callers that want the bare procedure text. */
export function stripPageMarkers(text: string): string {
  return text
    .split('\n')
    .filter((line) => !PAGE_MARKER_LINE.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
