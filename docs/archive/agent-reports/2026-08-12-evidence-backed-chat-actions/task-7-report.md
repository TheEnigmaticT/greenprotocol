# Task 7 verification report — 2026-08-12

## Scope and environment

This report records only observed Task 7 verification performed in the isolated `evidence-backed-chat` worktree. No production source, migration, plan/spec, SDD ledger, backlog, or commit was modified.

Local runtime configuration was inspected without exposing values. No `.env.local` or `.env` exists in this worktree, and the following required environment variables were unset: `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CHAT_LLM_BASE_URL`, `CHAT_LLM_API_KEY`, `CHAT_LLM_MODEL`, `CHAT_LLM_ALLOWED_MODELS`, `CHAT_LLM_ALLOWED_BASE_URLS`, `OPENAI_API_KEY`, `CHEMISTRY_SERVICE_URL`, and `CHEMISTRY_SERVICE_TOKEN`.

## Evidence matrix

| Brief item | Status | Evidence / exact command | Result or blocker |
|---|---|---|---|
| Focused importer contract | PASS | `python3 -m pytest scripts/literature/test_import_evidence_units_supabase.py -q` | `11 passed in 0.03s` (exit 0). |
| Focused TypeScript evidence/ranking/reevaluation/chat contracts | PASS | `npm test -- tests/lib/literature-evidence.test.ts tests/lib/pipeline-ranking.test.ts tests/lib/reevaluation.test.ts tests/lib/talk-about-this/tools.test.ts tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/prompt.test.ts tests/lib/talk-about-this/actions.test.ts tests/lib/talk-about-this/activity.test.ts` | `8 passed` test files; `85 passed` tests; duration 291 ms (exit 0). |
| Authenticated browser: open stable saved recommendation with retrievable evidence; observe activity before retrieval/final text | BLOCKED | Prerequisite inspection (no credentials printed) | No local Supabase URL/keys, no chat-provider configuration/API key, no chemistry-service configuration, and no authenticated browser session. A real saved analysis/evidence record cannot be accessed safely. |
| Authenticated browser: rendered evidence-unit ID/title/pages/quote and candidate label | BLOCKED | Same remote/browser prerequisite inspection | Requires the unavailable authenticated retrieval scenario. Static implementation inspection is separately recorded below and is not presented as browser proof. |
| Authenticated browser: recommendation approval receipt and only target card accepted; reload retains state/receipt/action fields | BLOCKED | Same remote/browser prerequisite inspection | Requires authenticated database and stable recommendation conversation. |
| Authenticated browser: principle-scope `approve this` produces no mutation | BLOCKED | Same remote/browser prerequisite inspection | Requires authenticated database and principle conversation. |
| Authenticated browser: two contexts approve different recommendations concurrently; stale PATCH returns 409 | BLOCKED | Same remote/browser prerequisite inspection | Requires two authenticated sessions and a remote database with the migration applied. |
| True first-model-delta TTFT instrumentation and three warm retrieval runs | FAIL | Inspected `app/api/talk-about-this/[conversationId]/messages/route.ts` lines 148–214, `lib/talk-about-this/agent.ts` lines 314–326, and searched these paths plus `lib/literature-evidence.ts` for timing-stage instrumentation | `ttftMs` is correctly set only on the first forwarded `delta` (not activity), persisted, and emitted in `done`. However, required timestamps for provider first text, embedding start/end, RPC start/end, and final provider first text are absent. The only observed timestamps are route start/first delta and an unrelated tool-loop deadline. No live timing can run because all chat, embedding, Supabase, and chemistry-service configuration is absent; no synthetic delta or substitute metric was used. |
| Warm TTFT release gate: three representative values each ≤3,000 ms | BLOCKED | No safe configured endpoint / retrievable evidence | No observed warm first-delta values; gate cannot pass without them. |
| Full project suite | PASS | `npm test` | `16 passed` test files; `125 passed` tests; duration 350 ms (exit 0). Re-run as part of `npm test && npm run build`: `16 passed`; `125 passed`; duration 338 ms (exit 0). |
| Production build | PASS | `npm run build` | Next.js 16.1.6 compiled, TypeScript completed, static pages generated, and final optimization completed (exit 0). Re-run as part of `npm test && npm run build` also exited 0. The only emitted notice was Next.js's middleware-to-proxy deprecation warning. |
| Combined project verification | PASS | `npm test && npm run build` | Both commands completed successfully (exit 0): 125/125 tests and successful optimized production build. |
| Migration verification | BLOCKED | Local configuration inspection; migration reviewed at `supabase/migrations/20260812000000_secure_talk_actions.sql` | No Supabase URL or service-role key, and no local Supabase configuration/instance was present. Applying or checking remote schema/RLS/RPC state was therefore not safe. |
| Evidence import and remote manifest/source/evidence counts | BLOCKED | Local configuration inspection; importer reviewed at `scripts/literature/import_evidence_units_supabase.py` | No `SUPABASE_URL`/service-role key and no CRGSC article index, evidence JSONL, embedding JSONL, or import manifest found in the worktree. Import was not attempted. The importer requires all four inputs plus credentials and rejects changed checksums. |
| CRGSC v5 embedding file is 1536-dimensional; checksums/counts match remote rows | BLOCKED | Local artifact/configuration inspection | No CRGSC v5 embedding artifact or complete import manifest is available locally, and remote row counts are unreachable without Supabase credentials. `VECTOR_DIMENSIONS = 1536` is enforced by importer code, but this does not verify an actual v5 artifact or remote data. |
| Neither Phase 2.5 nor Phase 2.7/reevaluation uses `literature_precedents` | PASS | Searched `lib/pipeline.ts`, `lib/literature-evidence.ts`, `lib/talk-about-this`, and `app/api/talk-about-this` for `literature_precedents` | No matches in the scoped recommendation/chat production paths. The obsolete standalone `lib/vector-search.ts` and legacy scripts still contain the term but are outside the checked new evidence-backed recommendation/chat path. |
| Every retrieved source is page-bounded and candidate/adjudication status remains visible | PASS | Inspected `lib/literature-evidence.ts`, `lib/talk-about-this/repository.ts`, and `components/TalkAboutThis.tsx` | Retrieval shaping rejects missing/invalid page range, title, quote, and candidate status. Persisted structured evidence includes ID, source document, pages, quote, and candidate status. UI validates these fields and renders `Candidate evidence` (or `Adjudicated evidence`) plus page range and quote. Live retrieval/browser rendering remains blocked above. |
| Chat uses configured Qwen/open-weights endpoint with no proprietary fallback | PASS | Inspected `lib/talk-about-this/chat-provider.ts`; searched chat implementation/API for `allow_fallbacks`, `CHAT_LLM`, `ANTHROPIC`, and `anthropic` | Provider requires configured `CHAT_LLM_*` values, model and base URL allowlists, and only permits loopback or `openrouter.ai`; no Anthropic path appears in scoped chat. OpenRouter requests set `provider.allow_fallbacks: false`. A live provider call is blocked by absent configuration. |
| Conversation target/context cannot be mutated after creation | PASS | Inspected repository/API and secure migration | Repository exposes conversation insert/load only; no conversation update path is present. The secure migration drops the user conversation UPDATE policy. Remote enforcement remains unverified because migration verification is blocked. |
| Receipts cannot be directly inserted by clients | PASS | Inspected `20260812000000_secure_talk_actions.sql` | RLS permits only user SELECT; `INSERT`, `UPDATE`, and `DELETE` are revoked from `anon`, `authenticated`, and `public`. Remote enforcement remains unverified because migration verification is blocked. |
| Direct approval has stable ID and one transactional RPC; duplicate/concurrent preservation | BLOCKED | Inspected `lib/talk-about-this/actions.ts` and secure migration | Static contract evidence: client calls only `approve_scoped_recommendation(p_conversation_id)` and validates receipt fields; RPC locks conversation/action/analysis, updates a recommendation by immutable scoped ID with revision guard, records the receipt, and has unique `(conversation_id, action_type)`. Concurrent remote behavior and stale-PATCH 409 were not executed; they remain blocked by missing authenticated remote prerequisites. |
| Dynamic chat citations persist/render as structured evidence, not model-text inference | BLOCKED | Inspected `repository.ts`, message route, and `TalkAboutThis.tsx` | Static contract evidence: the route passes tool-returned literature evidence into `assistantMessageCitations`, which persists structured evidence fields; the UI renders the structured receipt. An actual streamed response/reload is blocked by missing configured services and authentication. |

## Release decision and bookkeeping

**Release gate: FAIL and BLOCKED.** It fails the required instrumentation criterion: provider/embedding/RPC stage timestamps are absent. It is also blocked pending remote import counts, both live retrieval paths, atomic approval/concurrency browser checks, and three warm first-model-delta measurements. Those remote checks were not safely executable in this worktree because neither credentials/configuration nor required CRGSC import artifacts were present. Accordingly, `BACKLOG.md` and the approved spec were not modified and no commit was made.

## Required prerequisites to clear blockers

1. A safe authenticated Supabase environment with URL, browser authentication, service-role key for import/count verification, and migration `20260812000000_secure_talk_actions.sql` applied.
2. Canonical CRGSC v5 article index, evidence JSONL, 1536-dimensional embedding JSONL, and manifest in known paths with expected counts/checksums.
3. A configured `CHAT_LLM_*` OpenAI-compatible loopback or approved OpenRouter endpoint, an embedding key, and reachable chemistry service.
4. A stable saved analysis containing at least two recommendation IDs and known retrievable page-bounded candidate evidence, plus two browser contexts for the concurrency/stale-write checks.

## Task 7 Step 3 telemetry addendum

### RED

`npx vitest run tests/lib/literature-evidence.test.ts` failed as expected: the new retrieval boundary test expected four telemetry snapshots and received `[]`.

`npx vitest run tests/lib/talk-about-this/agent.test.ts` failed as expected: the new test expected separate initial/final provider first-text timestamps and received `undefined`.

`npx vitest run tests/lib/talk-about-this/latency.test.ts` failed as expected before the helper existed: `Cannot find package '@/lib/talk-about-this/latency'`.

### GREEN

- `npx vitest run tests/lib/literature-evidence.test.ts tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/repository.test.ts tests/lib/talk-about-this/latency.test.ts` — 4 files, 27 tests passed.
- `npx tsc --noEmit` — exit 0, no output.

### Implemented telemetry

- `performance.now()` measures embedding start/end and evidence-RPC start/end. The retrieval tool returns only structured stage times; no query, provider key, or secret is included.
- The agent records the first text in its initial provider pass and the first text after retrieval separately, propagating retrieval timing in the literature tool-complete activity and final result.
- The route keeps `ttft_ms` as the first forwarded `delta` from route start. The focused test proves activity/tool events cannot establish TTFT.
- The route writes a structured monotonic telemetry object into the existing JSONB `citations` payload and emits that same object in `done`; no migration is needed because the existing JSONB safely carries structured citation records.

### Remaining live-gate blocker

No configured chat provider, embedding key, Supabase environment, authenticated browser session, or retrievable warm evidence data is available in this worktree. Therefore three representative warm retrieval measurements and the ≤3,000 ms release criterion remain unobserved and blocked; this addendum does not claim the release gate passes.

## Task 7 telemetry repair addendum

### RED

- `npx vitest run tests/lib/talk-about-this/agent.test.ts` — the multi-tool-round test failed as expected: `finalProviderFirstTextAt` was `300` from an intermediate tool turn, rather than `400` from the final no-tool pass.
- `npx vitest run tests/lib/talk-about-this/tools.test.ts` — embedding/RPC failure and abort cases failed as expected because retrieval exceptions escaped and discarded captured stage telemetry.
- `npx vitest run tests/lib/talk-about-this/messages-route.test.ts` — terminal-persistence case failed as expected because no telemetry merge helper existed.

### GREEN

- `npx vitest run tests/lib/talk-about-this/messages-route.test.ts tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/tools.test.ts tests/lib/literature-evidence.test.ts tests/lib/talk-about-this/latency.test.ts` — 5 files, 36 tests passed.
- `npx tsc --noEmit` — exit 0, no output.

### Repair

- Per-turn text timestamps are held locally and promoted to `finalProviderFirstTextAt` only after that completed provider turn has no tool calls.
- Literature retrieval converts failures and aborts into controlled unavailable results with the latest finite stage timing. Abort receives its specific retrieval-aborted warning; other error details are not forwarded.
- Tool-complete SSE validation allows only finite, nonnegative stage timestamps no greater than 60,000 ms. The route merges that already-sanitized telemetry before terminal persistence and `done`.
- TTFT remains assigned exclusively by the first forwarded `delta`; activity and tool events cannot synthesize it.

### Remaining live blockers

The existing configured-provider, embedding, Supabase, authenticated-browser, source-artifact, and warm-retrieval prerequisites remain unavailable. No live timing gate result is claimed.

## Task 7 telemetry follow-up repair

### RED

- `npx vitest run tests/lib/talk-about-this/messages-route.test.ts tests/lib/talk-about-this/agent.test.ts` — 3 regression tests failed as expected: a `60_001` monotonic stage timestamp was dropped, terminal telemetry flattened two attempts into one cross-merged object, and agent telemetry had no atomic attempt list.

### GREEN

- `npx vitest run tests/lib/literature-evidence.test.ts tests/lib/talk-about-this/tools.test.ts tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/messages-route.test.ts tests/lib/talk-about-this/latency.test.ts` — 5 files, 37 tests passed.
- `npx tsc --noEmit` — exit 0, no output.

### Repair

- Stage timestamps now accept finite nonnegative monotonic `performance.now()` values without an uptime cap; an invalid supplied timestamp or out-of-order stage rejects that attempt snapshot.
- Each literature retrieval produces an ordered bounded `retrievalAttempts` snapshot with its call ID, terminal state (`complete`, `failed`, or `aborted`), and only that attempt's recorded stages. The same list is carried by tool-complete, persisted citations JSONB, and terminal `done` telemetry.
- Legacy top-level route/provider timestamps remain available to existing consumers; flattened retrieval stage fields are no longer emitted, preventing a partial second attempt from inheriting the first attempt's end/RPC values.

### Remaining external blocker

The configured-provider, embedding, Supabase, authenticated-browser, source-artifact, and warm-retrieval prerequisites remain unavailable. No live timing gate result is claimed.

## Final approval repair

### RED

- `npx vitest run tests/lib/talk-about-this/actions.test.ts` — 2 expected failures: `accept this` and `approve this recommendation` were not direct approval commands.
- `npx vitest run tests/lib/talk-about-this/repository.test.ts` — 2 expected failures because persisted action receipts had no hydration adapter.
- `npx vitest run tests/lib/talk-about-this/context.test.ts` — 1 expected failure because accepted state changed the context hash instead of reusing the immutable conversation.
- `npx vitest run tests/lib/talk-about-this/activity.test.ts` — expected failures for absent persisted receipt hydration and receipt presentation.
- `npx vitest run tests/lib/talk-about-this/page-state.test.ts` — 1 expected failure because normal PATCH reconciliation lacked a monotonic state boundary.

### GREEN

- `npx vitest run tests/lib/talk-about-this/actions.test.ts tests/lib/talk-about-this/context.test.ts tests/lib/talk-about-this/repository.test.ts tests/lib/talk-about-this/activity.test.ts tests/lib/talk-about-this/page-state.test.ts` — 5 files, 51 tests passed.
- `npx tsc --noEmit` — exit 0, no output.

### Repair

- The direct-command allowlist now includes exactly `approve this`, `accept this recommendation`, `accept this`, and `approve this recommendation`; question, negated, conditional, and compound forms remain rejected.
- Immutable context snapshots exclude the mutable acceptance flag. Opening the same scope now finds its existing context-hash conversation, loads the completed server action receipt, returns it, and TalkAboutThis validates, hydrates, and renders the stored action ID/revision/completion time. Receipt data is never derived from user message text.
- A normal delayed PATCH result only advances a matching page state revision. Approval reconciliation keeps the larger revision and sets only the receipt-targeted recommendation accepted, so stale save completion cannot undo a newer approval.

### Remaining external blocker

Remote Supabase migration/RPC and authenticated browser flows remain unavailable in this worktree; focused repository/component/state contracts cover durable receipt hydration and stale local reconciliation without claiming a live database verification.

## Idempotent approval receipt repair

### RED

- `npx vitest run tests/lib/talk-about-this/activity.test.ts` — 2 expected failures: the receipt-event reducer did not exist, so a hydrated action ID could not distinguish callback deduplication from receipt presentation.

### GREEN

- `npx vitest run tests/lib/talk-about-this/activity.test.ts` — 1 file, 30 tests passed.
- `npx tsc --noEmit` — exit 0, no output.

### Repair

- Sending another message no longer clears a durable approval receipt before the reply arrives.
- A matching repeat `recommendation-approved` event restores the display receipt even when its hydrated action ID has already deduplicated the parent approval callback. Mismatched receipts remain rejected before either display or callback handling.

### Concern

Remote Supabase/RPC and authenticated-browser flows remain unavailable in this worktree; this repair is covered by the focused component/activity regression and static TypeScript compilation, not a live approval stream.

## Accepted recommendation receipt-access repair

### RED

`npx vitest run tests/lib/talk-about-this/activity.test.ts` — 1 of 31 tests failed as expected. The accepted recommendation rendered under `Accepted Changes (1)`, but its SSR markup had no `aria-label="Talk about this. Direct evidence is included in this discussion."` control.

### GREEN

- `npx vitest run tests/lib/talk-about-this/activity.test.ts` — 1 file, 31 tests passed (exit 0; duration 269 ms).
- `npx tsc --noEmit` — exit 0; no output.

### Repair

- Accepted recommendation rows now render `TalkAboutThis` only when `rec.id` is present, using `{ kind: 'recommendation', recommendationId: rec.id }`, the same title, evidence-state derivation, analysis ID, and approval callback as pending cards.
- The control is visible in the accepted row rather than behind its existing row toggle. Its wrapper stops click propagation so opening the receipt/chat cannot trigger the accepted-card toggle or any approval mutation.
- The focused SSR regression renders an accepted stable recommendation with the accessible control and confirms that an ID-less accepted recommendation does not render a fallback-scoped control.

### Remaining external blocker

No configured chat provider, Supabase environment, or authenticated browser session is available in this worktree. The focused SSR/UI contract and static TypeScript compilation are verified; live persisted-receipt hydration after a remote reload remains unavailable for browser verification.
