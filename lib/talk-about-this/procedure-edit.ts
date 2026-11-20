import { createHash } from 'node:crypto'
import { MAX_PROTOCOL_CHARS, MIN_PROTOCOL_CHARS } from '@/lib/protocol-limits'

export const MAX_PROCEDURE_EDITS = 10
export const MAX_EDIT_FIND_CHARS = 4_000
export const MAX_EDIT_REPLACE_CHARS = 8_000
export const MAX_EDIT_RATIONALE_CHARS = 500
export const MAX_PROPOSAL_SUMMARY_CHARS = 300
/** Mirrors the diff column check in the proposals table. */
export const MAX_PROPOSAL_DIFF_CHARS = 200_000

const DIFF_CONTEXT_LINES = 2
/** Beyond this many LCS cells the middle of the diff degrades to one replace block. */
const MAX_LCS_CELLS = 4_000_000

export interface ProcedureEdit {
  find: string
  replace: string
  rationale: string
}

export interface ProcedureEditFailure {
  code:
    | 'no_edits'
    | 'too_many_edits'
    | 'empty_find'
    | 'find_too_long'
    | 'replace_too_long'
    | 'no_match'
    | 'ambiguous'
    | 'overlap'
    | 'no_change'
    | 'too_short'
    | 'too_long'
    | 'diff_too_large'
  editIndex?: number
  /** Written for the model: says what to change so a corrected proposal can be sent. */
  message: string
}

export type ProcedureEditResult =
  | { ok: true; baseText: string; proposedText: string; diff: string }
  | { ok: false; failure: ProcedureEditFailure }

/** Line endings are normalised so the model's plain "\n" finds match pasted Windows text. */
export function normalizeProcedureText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

export function hashProcedureText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function fail(code: ProcedureEditFailure['code'], message: string, editIndex?: number): ProcedureEditResult {
  return { ok: false, failure: { code, message, ...(editIndex === undefined ? {} : { editIndex }) } }
}

function occurrences(text: string, find: string): number[] {
  const starts: number[] = []
  // Overlapping matches count: "aa" occurs twice in "aaa", which is still ambiguous.
  for (let index = text.indexOf(find); index !== -1 && starts.length < 2; index = text.indexOf(find, index + 1)) {
    starts.push(index)
  }
  return starts
}

/**
 * Applies find/replace edits to the saved procedure. Each `find` must occur exactly once
 * (the same single-match rule used for SciSure workspace edits), edits must not overlap, and
 * the result must stay inside the protocol size limits. Nothing is partially applied.
 */
export function applyProcedureEdits(savedText: string, edits: readonly ProcedureEdit[]): ProcedureEditResult {
  const baseText = normalizeProcedureText(savedText)
  if (edits.length === 0) return fail('no_edits', 'Provide at least one edit.')
  if (edits.length > MAX_PROCEDURE_EDITS) {
    return fail('too_many_edits', `Provide at most ${MAX_PROCEDURE_EDITS} edits per proposal.`)
  }

  const spans: { start: number; end: number; replace: string; index: number }[] = []
  for (const [index, edit] of edits.entries()) {
    const label = `Edit ${index + 1}`
    if (!edit.find) return fail('empty_find', `${label}: the text to find must not be empty.`, index)
    if (edit.find.length > MAX_EDIT_FIND_CHARS) {
      return fail('find_too_long', `${label}: the text to find is longer than ${MAX_EDIT_FIND_CHARS} characters. Quote a shorter exact passage.`, index)
    }
    if (edit.replace.length > MAX_EDIT_REPLACE_CHARS) {
      return fail('replace_too_long', `${label}: the replacement is longer than ${MAX_EDIT_REPLACE_CHARS} characters. Split it into smaller edits.`, index)
    }
    const found = occurrences(baseText, normalizeProcedureText(edit.find))
    if (found.length === 0) {
      return fail('no_match', `${label}: the text to find does not appear in the saved procedure. Copy it exactly, including punctuation, units and spacing.`, index)
    }
    if (found.length > 1) {
      return fail('ambiguous', `${label}: the text to find appears more than once in the saved procedure. Include more surrounding words so it matches exactly once.`, index)
    }
    const find = normalizeProcedureText(edit.find)
    spans.push({ start: found[0], end: found[0] + find.length, replace: normalizeProcedureText(edit.replace), index })
  }

  spans.sort((left, right) => left.start - right.start)
  for (let position = 1; position < spans.length; position += 1) {
    if (spans[position].start < spans[position - 1].end) {
      return fail(
        'overlap',
        `Edit ${spans[position - 1].index + 1} and edit ${spans[position].index + 1} change overlapping text. Merge them into one edit.`,
        spans[position].index,
      )
    }
  }

  let proposedText = ''
  let cursor = 0
  for (const span of spans) {
    proposedText += baseText.slice(cursor, span.start) + span.replace
    cursor = span.end
  }
  proposedText += baseText.slice(cursor)

  if (proposedText === baseText) return fail('no_change', 'The edits leave the procedure unchanged.')
  if (proposedText.trim().length < MIN_PROTOCOL_CHARS) {
    return fail('too_short', `The edited procedure would be shorter than ${MIN_PROTOCOL_CHARS} characters.`)
  }
  if (proposedText.length > MAX_PROTOCOL_CHARS) {
    return fail('too_long', `The edited procedure would be longer than ${MAX_PROTOCOL_CHARS.toLocaleString('en-US')} characters.`)
  }

  const diff = computeUnifiedDiff(baseText, proposedText)
  if (diff.length > MAX_PROPOSAL_DIFF_CHARS) return fail('diff_too_large', 'The change is too large to review. Propose fewer or smaller edits.')

  return { ok: true, baseText, proposedText, diff }
}

interface DiffLine {
  kind: ' ' | '-' | '+'
  text: string
}

function lineDiff(before: string[], after: string[]): DiffLine[] {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1

  const removed = before.slice(prefix, before.length - suffix)
  const added = after.slice(prefix, after.length - suffix)
  const lines: DiffLine[] = before.slice(0, prefix).map(text => ({ kind: ' ', text }))

  if ((removed.length + 1) * (added.length + 1) > MAX_LCS_CELLS) {
    lines.push(...removed.map((text): DiffLine => ({ kind: '-', text })), ...added.map((text): DiffLine => ({ kind: '+', text })))
  } else {
    // lengths[i][j] = longest common subsequence of removed[i..] and added[j..].
    const width = added.length + 1
    const lengths = new Uint32Array((removed.length + 1) * width)
    for (let i = removed.length - 1; i >= 0; i -= 1) {
      for (let j = added.length - 1; j >= 0; j -= 1) {
        lengths[i * width + j] = removed[i] === added[j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < removed.length && j < added.length) {
      if (removed[i] === added[j]) {
        lines.push({ kind: ' ', text: removed[i] })
        i += 1
        j += 1
      } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
        lines.push({ kind: '-', text: removed[i] })
        i += 1
      } else {
        lines.push({ kind: '+', text: added[j] })
        j += 1
      }
    }
    for (; i < removed.length; i += 1) lines.push({ kind: '-', text: removed[i] })
    for (; j < added.length; j += 1) lines.push({ kind: '+', text: added[j] })
  }

  lines.push(...before.slice(before.length - suffix).map((text): DiffLine => ({ kind: ' ', text })))
  return lines
}

/** Unified-style text for display: `@@ -a,b +c,d @@` hunks with two lines of context. */
export function computeUnifiedDiff(before: string, after: string): string {
  const lines = lineDiff(before.split('\n'), after.split('\n'))

  const keep = new Uint8Array(lines.length)
  lines.forEach((line, index) => {
    if (line.kind === ' ') return
    const from = Math.max(0, index - DIFF_CONTEXT_LINES)
    const to = Math.min(lines.length - 1, index + DIFF_CONTEXT_LINES)
    for (let position = from; position <= to; position += 1) keep[position] = 1
  })

  const output: string[] = []
  let beforeLine = 1
  let afterLine = 1
  let index = 0
  while (index < lines.length) {
    if (!keep[index]) {
      beforeLine += 1
      afterLine += 1
      index += 1
      continue
    }
    const hunkBeforeStart = beforeLine
    const hunkAfterStart = afterLine
    let beforeCount = 0
    let afterCount = 0
    const body: string[] = []
    for (; index < lines.length && keep[index]; index += 1) {
      const line = lines[index]
      body.push(`${line.kind}${line.text}`)
      if (line.kind !== '+') beforeCount += 1
      if (line.kind !== '-') afterCount += 1
    }
    beforeLine += beforeCount
    afterLine += afterCount
    // Unified diff convention: an empty side is addressed by the line before it.
    const beforeStart = beforeCount === 0 ? hunkBeforeStart - 1 : hunkBeforeStart
    const afterStart = afterCount === 0 ? hunkAfterStart - 1 : hunkAfterStart
    output.push(`@@ -${beforeStart},${beforeCount} +${afterStart},${afterCount} @@`, ...body)
  }
  return output.join('\n')
}
