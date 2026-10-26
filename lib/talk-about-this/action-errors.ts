/**
 * Maps a failed chat-action RPC to an HTTP status and wording a bench chemist can act on.
 * Raw database text (which can name tables, functions or columns) never reaches the client;
 * it is logged by the caller instead.
 */
export type TalkActionKind = 'decision' | 'proposal'

export interface TalkActionFailure {
  status: number
  code: string
  message: string
}

/** Carries the SQLSTATE from a failed RPC so routes can answer without parsing messages. */
export class TalkActionError extends Error {
  readonly sqlState: string | undefined

  constructor(message: string, sqlState?: string) {
    super(message)
    this.name = 'TalkActionError'
    this.sqlState = sqlState
  }
}

const DECISION_FAILURES: Record<string, TalkActionFailure> = {
  '42501': { status: 401, code: 'sign_in_required', message: 'Please sign in again to change this recommendation.' },
  P0002: { status: 409, code: 'recommendation_changed', message: 'This recommendation is no longer part of the saved analysis, so it could not be changed. Reload the analysis to see the latest version.' },
  '40001': { status: 409, code: 'analysis_changed', message: 'The analysis changed while you were deciding, so nothing was saved. Try again.' },
  '22023': { status: 400, code: 'not_decidable', message: 'This chat is not about a single recommendation, so it cannot approve or reject one.' },
}

const PROPOSAL_NOT_FOUND: TalkActionFailure = { status: 404, code: 'proposal_not_found', message: 'We could not find that proposal. A newer proposal may have replaced it.' }

const PROPOSAL_FAILURES: Record<string, TalkActionFailure> = {
  // A malformed id can never name a stored proposal.
  '22P02': PROPOSAL_NOT_FOUND,
  '42501': { status: 401, code: 'sign_in_required', message: 'Please sign in again to work with this proposal.' },
  P0002: PROPOSAL_NOT_FOUND,
  '55000': { status: 409, code: 'proposal_closed', message: 'This proposal was already used, cancelled or replaced. Ask for a new one if you still want the change.' },
  '40001': { status: 409, code: 'procedure_changed', message: 'The saved procedure changed after this was proposed, so the proposal is out of date. Ask for a new one.' },
  '22023': { status: 400, code: 'not_editable', message: 'This chat cannot propose changes to the procedure.' },
}

const FALLBACK_FAILURES: Record<TalkActionKind, TalkActionFailure> = {
  decision: { status: 500, code: 'decision_failed', message: 'We could not save that decision. Please try again.' },
  proposal: { status: 500, code: 'proposal_failed', message: 'We could not complete that. Please try again.' },
}

export function talkActionFailure(error: unknown, kind: TalkActionKind): TalkActionFailure {
  const table = kind === 'decision' ? DECISION_FAILURES : PROPOSAL_FAILURES
  const sqlState = error instanceof TalkActionError ? error.sqlState : undefined
  return sqlState !== undefined && Object.hasOwn(table, sqlState) ? table[sqlState] : FALLBACK_FAILURES[kind]
}
