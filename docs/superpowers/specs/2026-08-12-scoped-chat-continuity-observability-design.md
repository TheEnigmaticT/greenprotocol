# Scoped chat continuity and diagnostic observability — design

**Date:** 2026-08-12  
**Status:** Approved for planning

## Goal

Preserve and resume scoped scientific conversations, provide a fresh auditable conversation on demand, make chat submission keyboard-native, and turn tool failures into durable diagnostics plus concise scientific verification notes.

The chat remains an open-weights, OpenAI-compatible integration. Quality takes priority over speed, but normal warm-path first visible model text must start in at most 3,000 ms.

## Root-cause evidence

The supplied conversation reported, in order:

1. two CHEM21 tool calls whose execution deadlines elapsed;
2. a PubChem call that then exceeded the remaining global execution deadline; and
3. a fourth requested tool skipped by the three-calls-per-turn limit.

`lib/talk-about-this/agent.ts` establishes a 12,000 ms tool-loop deadline and runs calls serially. Each call is permitted up to 5,000 ms. Therefore two timed-out calls can consume about 10,000 ms before the third begins; the third receives only the remaining budget. The existing model must then make a final provider pass, so tool-loop failure cannot itself explain a three-minute wait, but it creates a repeatable extra delay and currently loses durable per-call diagnostics.

## Existing state

- `gpc_talk_conversations` stores an immutable context snapshot and its hash. The opening route reuses the newest owned conversation with the same hash.
- `gpc_talk_messages` already persists all user and assistant message content, citations, terminal state, and `ttft_ms`.
- The client clears its local transcript after opening a reused conversation instead of loading persisted messages.
- The message route sends transient SSE `tool-start`, `tool-complete`, and `tool-failed` events, but only successful literature-retrieval timing is preserved in assistant-message citation metadata.
- `gpc_talk_actions` provides a durable, server-owned approval receipt. A resumed conversation already retrieves that receipt.
- The agent may call only read-only, server-executed chemistry and literature tools. The client never supplies tool credentials or context.

## Architecture

### Conversation lifecycle

The existing `POST /api/talk-about-this` endpoint accepts an optional boolean `newConversation` field, defaulting to `false`.

- `false`: build the current immutable snapshot, reuse the newest owned conversation with its hash when it exists, and return its serializable UI history, evidence receipts, and approval receipt.
- `true`: build the same fresh snapshot but always insert a new `gpc_talk_conversations` row. It does not close, mutate, delete, or hide prior rows.

The opening response includes:

```ts
interface OpenConversationResponse {
  conversationId: string
  scope: TalkAboutScope
  contextHash: string
  noDirectEvidence: boolean
  disposition: 'created' | 'resumed'
  messages: PersistedChatMessage[]
  approvalReceipt: PersistedRecommendationApprovalReceipt | null
  evidenceReceipts: PersistedEvidenceReceipt[]
}
```

`PersistedChatMessage` is a UI-safe projection of `TalkMessage`: role, content, persisted citations/terminal status, `ttft_ms`, and `created_at`. It does not expose diagnostic error details. `PersistedEvidenceReceipt` uses one shared validated DTO in repository and client code; it preserves source-document/page-bound evidence, finite similarity, and assistant-message creation time. Old citations without a valid shared DTO do not produce a receipt.

`/new` and `/clear` are exact whole-composer commands, after trimming. They use the `newConversation` opening request rather than being persisted as user text or sent to the model. The dialog also exposes a **New chat** button which follows the identical function. Existing conversations remain queryable/auditable and their model context is not silently carried forward.

### Composer interaction

- Enter submits a non-empty composer only when no response is streaming.
- Shift+Enter inserts a newline.
- Enter has no effect while streaming; Stop aborts the request.
- Esc closes the dialog and cancels its active request.
- After a successful new conversation, clear local message/activity/error/evidence state, display **New scoped chat**, and focus the textarea.
- After opening a reused conversation, hydrate the returned chronological history, evidence receipts, and durable approval receipt, display **Resumed chat**, and focus the textarea.

The model still receives only the server’s bounded recent message window. Persistence preserves the complete transcript; it is not an instruction to give unbounded model context.

### Tool execution and diagnostics

Create `gpc_talk_tool_runs`, an append-only table for one attempted model-requested tool call. It is an internal diagnostic ledger, not a user-writable feature.

Each row includes:

- `id`, `conversation_id`, `analysis_id`, `user_id`, and nullable `user_message_id` / `assistant_message_id` relationships;
- a per-response `turn_id` generated by the server;
- `provider_round`, model tool `call_id`, tool name, and normalized validated argument JSON;
- `status`: `completed`, `failed`, `timed_out`, `cancelled`, or `skipped_limit`;
- a normalized `reason_code` and optional bounded `reason_detail`;
- dispatch budget, started/completed timestamps, and integer elapsed milliseconds;
- sanitized tool telemetry JSON, including HTTP/cache/retrieval-stage fields when supplied by the tool; and
- `created_at`.

The database permits `SELECT` only to the record owner under RLS. Direct browser/table writes and RPC execution are revoked. Server code writes records through narrow `SECURITY DEFINER` RPCs executable only through the server’s service-role client after the route authenticates the cookie session. The RPC receives that server-derived user ID, locks the matching owned conversation, derives `analysis_id`, rejects mismatched associations, validates the status/reason vocabulary, and inserts the row. Ledger failure is logged server-side but never changes a scientific answer into a fabricated result.

Diagnostics must be created for parsed/validated calls that complete, throw, time out, are aborted, or are skipped because they exceed the call limit. A parse/validation failure is also represented as `failed` with a generic, non-secret sanitized argument summary. Raw provider prompts, response content, authorization headers, API keys, and unbounded stack traces are never stored in this table.

Associate the inbound persisted user message before starting the agent. The terminal assistant message is created once the stream settles. After it has an ID, update the matching response’s tool-run rows through a narrow owner-validated RPC. This preserves a complete trail even if the terminal assistant response is cancelled or failed.

### Tool scheduling

The implementation must not increase timeouts as its first latency response.

Within a provider round, first perform syntax, allowed-name, argument-shape, and immutable-scope validation without requiring a lookup-produced canonical SMILES value. Create a deterministic fingerprint from normalized arguments. Calls with the same fingerprint reuse the first result and each requested call still receives its own `gpc_talk_tool_runs` row marked `completed` or the corresponding terminal failure status with `deduplicatedFromCallId` telemetry.

Run only independent prevalidated calls concurrently under the existing one-loop deadline. PubChem prerequisite calls run before canonical-SMILES-dependent screening or experimental-solubility calls for the same solute. After PubChem succeeds, ingest the canonical SMILES, fully validate and dispatch the dependent call. If it does not produce a required structure, return unavailable/tool-error rather than incorrectly labelling the dependent request invalid. Results are appended to the model tool-message sequence in original requested-call order, irrespective of completion order.

The global loop deadline remains authoritative. Every dispatched call receives `min(per-call timeout, remaining global budget)` and observes the client abort signal before and after execution. A call that returns after abort is discarded and classified as `timed_out` or `cancelled`; a client stop is `cancelled`; a call never dispatched because it is over the request’s allowed-call limit is `skipped_limit`. Per-round tool-call count remains three unless measured evidence supports a separate design change.

### User-visible verification notes

Tool execution remains visible as live activity. It must not render raw infrastructure errors as scientific facts.

Map normalized failures to concise, source-aware notes:

- `timed_out`: “Couldn’t verify {source} data before the response deadline.”
- `cancelled`: “{Source} verification was stopped.”
- `skipped_limit`: “Additional verification was skipped to keep this response bounded.”
- other failure: “{Source} verification was unavailable for this response.”

Group duplicate notes by source plus normalized reason, display them under an expandable **Verification notes** disclosure after streaming settles, and retain only the concise note in the UI state. The complete diagnostic row remains available only to authorized operational inspection.

The system prompt and final-answer contract must require that a tool’s unavailable result never supports a claim. The answer must state whether a conclusion derives from the immutable saved analysis, an actual completed retrieval, or lacks verification. No citation is emitted for failed/unavailable data.

### Latency instrumentation

Persist and surface only safe timing aggregates in `gpc_talk_messages` metadata:

- provider-round start and first-text times;
- initial and final provider-first-text times;
- request-to-first-forwarded-model-delta (`ttft_ms`);
- per-call diagnostic ID/status/elapsed time and valid retrieval-stage timing when present; and
- bounded scheduling metadata (requested count, dispatched count, deduplicated count).

A first forwarded `delta` remains the sole `ttft_ms` definition. `thinking`, tool activity, and cached persisted text do not establish TTFT. The release gate is three representative **warm**, authenticated scoped chat runs with configured provider, embeddings, Supabase, and chemistry service: each must have first model delta at or below 3,000 ms. A failed run produces diagnostics and is not counted as a passing representative run.

## Data migration

Create one timestamped migration which:

1. creates `gpc_talk_tool_runs` with foreign keys to conversation, analysis, user, and optional messages;
2. validates status and reason-code values with check constraints;
3. enables RLS, adds owner `SELECT`, revokes direct `INSERT`, `UPDATE`, and `DELETE` from browser roles;
4. indexes `conversation_id, created_at`, `user_message_id`, and `assistant_message_id`; and
5. defines narrowly typed `SECURITY DEFINER` insert and assistant-message-link RPCs with explicit `search_path`, server-derived ownership, and `service_role`-only execution.

Rows are append-only. The link RPC may fill only an initially null `assistant_message_id` for a matching owner/conversation/turn, preventing reassociation or arbitrary update.

## Error handling

- Opening/hydration failure: leave the dialog closed and show the existing accessible error alert.
- New-conversation failure: keep the current loaded transcript untouched, show an error, and do not clear input until the request succeeds.
- Message-history read failure: fail the opening request; never present a resumed chat as empty.
- Diagnostic-ledger write failure: emit a server-side structured log with conversation/turn/call identifiers and continue the tool result flow; do not expose internal database errors to the user.
- Tool timeout/throw/cancel/limit: persist the diagnostic event, provide the normalized tool result to the model, and show one human-friendly verification note.
- Tool result with no records: is a completed no-match, not a failure; it may state that no matching evidence was found but cites nothing.
- Stream terminal failure/cancellation: persist the assistant terminal message and all tool-run records collected before termination.

## Tests and verification

### Repository and opening route

- Existing matching context reuses a conversation and returns chronological persisted message history, valid evidence receipts, and approval receipt.
- `newConversation: true` creates a distinct conversation with the same immutable snapshot/hash and returns no old messages.
- Cross-user and cross-analysis conversations/messages/actions are never returned.
- Invalid `newConversation` values return 400.

### Client behavior

- Reopened conversations render persisted messages and display **Resumed chat**.
- New chat button, `/new`, and `/clear` call the same new-conversation path, clear only local active state after success, and display **New scoped chat**.
- Enter submits; Shift+Enter adds newline; commands are never sent to the message endpoint; streaming blocks Enter submission.
- Verification notes render friendly grouped copy and never raw deadline/stack text.

### Agent scheduling and diagnostic contract

- Equivalent validated calls execute once and every requested call receives a deterministic result/audit outcome.
- Independent calls overlap; dependent PubChem/RDKit calls remain ordered; model tool messages remain in original call order.
- Timeout, abort, limit skip, parse failure, and tool throw produce the exact normalized status/reason and no fabricated citations.
- First forwarded delta is still TTFT; tool activity does not establish it.

### Migration/RPC and route persistence

- Owner can read only their rows; direct table writes are rejected.
- RPC rejects unauthenticated, unknown, cross-user, cross-conversation, invalid-status, oversized-detail, and reassociation requests.
- One streamed response writes an inbound user message, exact per-call diagnostic rows, a terminal assistant message, and links rows to both messages.
- Ledger insert/link failure is observable server-side and does not change the terminal response semantics.

### Release smoke test

1. Configure the approved open-weights OpenAI-compatible provider, Supabase, embedding service, and chemistry service.
2. Open a recommendation chat, send the supplied DCM-to-ethyl-acetate question, then close and reopen it; observe the same persisted transcript and verification notes.
3. Invoke `/new`; observe a fresh ID/snapshot row, no prior transcript, and retained prior audit history.
4. Exercise a controlled tool timeout and verify one friendly note plus its authorized diagnostic record.
5. Execute three authenticated warm scoped chat requests with representative retrieval. Record the first forwarded model-delta timings and require each to be at most 3,000 ms.

## Out of scope

- Changing the existing analysis/recommendation approval contract.
- Browser access to tool diagnostics or raw infrastructure errors.
- Proprietary model fallback.
- Increasing tool timeouts without measured evidence.
- Replaying all persisted history into the provider.
- Autonomous recommendation changes, rescoring, or protocol mutation.
