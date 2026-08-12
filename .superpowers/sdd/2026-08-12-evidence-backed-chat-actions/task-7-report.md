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
