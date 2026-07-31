# Talk About This Agent Implementation Plan

> **For Hermes:** Use the subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Give scientists a safe, context-rich conversation entry point from recommendation cards and Evidence Atlas sections so they can understand, challenge, and selectively re-evaluate GC.ai output without silently changing the saved analysis.

**Architecture:** Add a shared conversation-context contract that can be built from a saved analysis, a recommendation, or an Evidence Atlas principle/evidence target. The first slice uses a server-side chat route with an explicit read-only context bundle and a narrow set of server-controlled tools; rescore/regeneration returns a proposed artifact rather than mutating `gpc_analyses`. Persist messages, feedback, tool calls, and proposals as attributable audit records tied to the analysis and conversation.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase/Postgres RLS, existing `AnalysisResult`/`Recommendation` types, existing `/api/rescore` path, `lib/chemistry-service.ts`, `lib/vector-search.ts`, existing trace tables, and the configured LLM provider.

**Current substrate verified:**
- Recommendation cards and Accept state are in `components/AnalysisResults.tsx`.
- Evidence Atlas section anchors and recommendation-to-principle links are in `components/PrincipleSection.tsx` and `app/analyze/[id]/evidence/page.tsx`.
- Saved analysis data is stored in `gpc_analyses`; user-owned trace and dedup tables exist in `supabase/migrations/20260713000000_create_trace_tables.sql`.
- Existing deterministic rescore entry point is `app/api/rescore/route.ts`.
- Existing chemical/scoring seams include `lib/chemistry-service.ts`, `lib/vector-search.ts`, `lib/scoring/`, and the Python RDKit service behind the chemistry client.

---

## Product contract

### Entry points

1. **Recommendation card:** `Talk about this` opens a conversation scoped to one recommendation and its originating step.
2. **Evidence Atlas:** `Talk about this` opens a conversation scoped to one principle/evidence section, optionally retaining the originating recommendation ID when deep-linked from a card.

Both entry points use the same context builder and chat surface. The UI must show the scope before the first message is sent.

### Context bundle

The server, not the browser, assembles the bundle from the authenticated user's saved analysis:

- `analysisId`, software/methodology version, protocol title, and original protocol text
- selected scope: `recommendationId`, `stepNumber`, principle IDs, or Evidence Atlas target
- relevant step decomposition and chemical/condition data
- recommendation before/after fields, severity, confidence, acceptance state, benefit/delta fields
- deterministic scores and provenance for relevant principles
- evidence citations, evidence tier, source URLs/DOIs, and explicit no-direct-evidence state
- relevant process traces and dedup records, redacted to avoid exposing unrelated analyses or secrets
- prior feedback and proposals for this conversation only
- tool availability and limitations (for example, lifecycle analysis unavailable until its adapter exists)

The bundle should be versioned and bounded. Do not pass raw full trace payloads or unrelated recommendations by default; expose summarized trace metadata and allow a narrowly scoped forensic expansion only when needed.

### Safety and mutation rules

- Chat, explanation, and feedback capture are read-only against the saved analysis.
- Rescore, RDKit recalculation, retrieval, or lifecycle calculations produce a proposal with inputs, outputs, provenance, and audit link.
- The agent cannot apply Accept/Reject, overwrite `analysis_result`, or alter the original protocol implicitly.
- Applying a proposal is a separate explicit user action with optimistic concurrency protection and a before/after record.
- Tool calls are allowlisted server-side, authenticated, schema-validated, rate-limited, and logged.
- Unsupported or unauthorized requests produce an explicit explanation and an audit event.

---

## Phase 1 — Contract and persistence foundation

### Task 1: Add conversation domain types and context schema

**Files:**
- Modify: `lib/types.ts`
- Create: `lib/talk-about-this/types.ts`
- Test: `lib/talk-about-this/__tests__/context-schema.test.ts`

Define `TalkAboutScope`, `TalkAboutContext`, `TalkAboutMessage`, `TalkAboutToolCall`, `TalkAboutProposal`, and `TalkAboutFeedback`. Include schema/version fields, stable analysis/recommendation/principle IDs, provenance, and an explicit `readOnly`/`proposal` distinction. Reject contexts with no valid analysis ID or no selected scope.

Run: `npm test -- --runInBand lib/talk-about-this/__tests__/context-schema.test.ts`

### Task 2: Add Supabase tables and RLS policies

**Files:**
- Create: `supabase/migrations/YYYYMMDD000000_create_talk_about_this.sql`
- Test/verify: Supabase migration validation or project migration check

Create tables for:
- conversations (`analysis_id`, `user_id`, scope JSONB, context version, status, timestamps)
- messages (role, content, citations/context references, conversation ID)
- feedback (structured category, free text, target IDs, disposition)
- proposals (type, input snapshot, candidate output, status, applied analysis version)
- tool calls (tool name, validated input, output summary, success/error, timestamps)

Add owner-only RLS. Foreign-key conversations to `gpc_analyses`. Keep raw sensitive trace payloads out of client-readable message rows unless the existing trace policy explicitly permits the user to view them.

Verify with the repository's migration/test command and inspect the generated SQL for owner isolation.

### Task 3: Build the server-side context assembler

**Files:**
- Create: `lib/talk-about-this/build-context.ts`
- Create: `lib/talk-about-this/redaction.ts`
- Test: `lib/talk-about-this/__tests__/build-context.test.ts`

Load a saved analysis using the authenticated user's server Supabase client. Resolve the selected recommendation/principle and collect only relevant steps, scores, evidence, traces, and dedup metadata. Return a deterministic context hash so the conversation can identify exactly what was submitted. Redact API keys, prompt secrets, unrelated analyses, and oversized raw payloads.

Test recommendation scope, Evidence Atlas scope, missing target, stale recommendation index, no-direct-evidence, and bounded trace selection.

---

## Phase 2 — Chat entry points and read-only agent

### Task 4: Add conversation creation and message APIs

**Files:**
- Create: `app/api/talk-about-this/route.ts`
- Create: `app/api/talk-about-this/[conversationId]/messages/route.ts`
- Create: `lib/talk-about-this/repository.ts`
- Test: `app/api/talk-about-this/__tests__/route.test.ts`

Implement authenticated creation from `{ analysisId, scope }`, persistence of the context hash/version, and message submission. Stream or return assistant responses using the existing LLM integration. The system prompt must state that the user is discussing a recommendation, show the scoped context, preserve uncertainty, and never claim a proposal was applied.

Validate ownership, request size, scope IDs, and message rate limits. Do not accept an arbitrary context bundle from the browser.

### Task 5: Add shared chat UI and recommendation entry point

**Files:**
- Modify: `components/AnalysisResults.tsx`
- Create: `components/TalkAboutThisDialog.tsx`
- Create: `components/TalkAboutThisChat.tsx`
- Test: existing component test location or `tests/talk-about-this.spec.ts`

Add a third action beside the current Accept control without changing Accept/Reject semantics. Display the selected recommendation, context summary, evidence state, and a free-text conversation box. Include structured feedback affordances such as “chemistry is incompatible,” “condition is unavailable,” “yield assumption is wrong,” and “other,” plus free text. Keep keyboard focus and mobile layout usable.

Verify that opening the dialog does not mutate `isAccepted`, and that the request contains only analysis/scope identifiers.

### Task 6: Add the Evidence Atlas entry point

**Files:**
- Modify: `components/PrincipleSection.tsx`
- Modify: `app/analyze/[id]/evidence/page.tsx` if needed for target IDs
- Test: Evidence Atlas interaction test

Add `Talk about this` at the principle/evidence-section level. Preserve the existing deep-link anchor and pass a stable principle/evidence scope to the shared dialog. If opened from a recommendation deep link, retain the recommendation target where available.

Verify sourced, inferred, unavailable, and empty-evidence states render honestly.

---

## Phase 3 — Allowlisted scientific tools and proposals

### Task 7: Define the tool registry and schemas

**Files:**
- Create: `lib/talk-about-this/tools.ts`
- Create: `lib/talk-about-this/tool-schemas.ts`
- Test: `lib/talk-about-this/__tests__/tools.test.ts`

Start with narrowly scoped tools:
- `explain_score_inputs` — read-only provenance explanation
- `retrieve_evidence` — scoped literature/vector search
- `recalculate_chemistry` — RDKit/chemistry-service calculation for specified inputs
- `candidate_rescore` — invoke existing deterministic rescore path using an explicit candidate protocol
- `record_feedback` — structured feedback only

Add lifecycle/PMI as an adapter interface with an unavailable response until the lifecycle implementation is present. Never expose arbitrary HTTP, shell, SQL, or model-provider tools to the agent.

Every tool returns `{ status, result, provenance, limitations, auditId }` and is logged before the assistant receives the result.

### Task 8: Add proposal generation and explicit apply flow

**Files:**
- Create: `app/api/talk-about-this/[conversationId]/tools/route.ts`
- Create: `app/api/talk-about-this/[conversationId]/proposals/[proposalId]/apply/route.ts`
- Create: `lib/talk-about-this/proposals.ts`
- Modify: `app/api/analyses/[id]/route.ts` only if a shared optimistic-concurrency helper is needed
- Test: proposal and apply route tests

Allow the agent to generate a candidate rescore or regenerated recommendation, but store it separately with the original analysis snapshot, tool inputs, changed fields, score/provenance deltas, and uncertainty. Applying requires an explicit user action, verifies the saved analysis version/hash, and writes a before/after audit record. Accept/Reject changes remain a separate explicit action.

Test stale analysis version, unauthorized conversation, proposal with unavailable data, successful apply, and idempotent repeated apply.

### Task 9: Add audit linkage and observability

**Files:**
- Create: `supabase/migrations/YYYYMMDD000001_add_talk_about_this_audit_links.sql` if needed
- Modify: `lib/trace.ts`
- Modify: `lib/talk-about-this/repository.ts`
- Test: audit linkage tests

Link conversation, message, tool call, proposal, and applied change IDs to the existing analysis trace/audit model. Store model, latency, token usage, tool name, context hash, and outcome without leaking secrets. Make it possible to answer: what did the agent know, what did it call, what changed, and who applied it?

---

## Phase 4 — Verification and rollout

### Task 10: Add end-to-end coverage for both entry points

**Files:**
- Create/modify: `tests/talk-about-this.spec.ts`
- Modify: test fixtures or auth helpers as required

Cover:
1. recommendation card opens scoped chat;
2. Evidence Atlas opens scoped chat;
3. explanation response cites context and uncertainty;
4. feedback is persisted without changing Accept/Reject;
5. tool call creates a proposal, not a silent mutation;
6. explicit apply changes the saved analysis and records before/after audit data;
7. unauthorized cross-user analysis access is rejected;
8. unsupported lifecycle request is honestly marked unavailable.

Run targeted tests first, then `npm run lint`, `npm run build`, and the repository's complete test command.

### Task 11: Document rollout boundaries

**Files:**
- Create: `docs/research/2026-07-31-talk-about-this-agent-contract.md`
- Modify: `README.md` or `docs/README.md` only if there is an existing feature-document index

Document the context contract, tool allowlist, mutation rules, retention/redaction decisions, and known gaps. Specifically separate the first shippable scoring/RDKit/retrieval tools from the future lifecycle-analysis adapter.

---

## Recommended first development slice

Start with Tasks 1–6 before adding any autonomous tool behavior. That delivers the user-visible `Talk about this` workflow, grounded explanation, and structured feedback while protecting the saved analysis. Then implement Tasks 7–9 as a second gated slice, beginning with read-only retrieval and deterministic recalculation before enabling candidate rescoring or proposal application.

## Definition of done

- Both UI surfaces open the same scoped conversation experience.
- The server builds and stores a bounded context bundle from the saved analysis rather than trusting browser-supplied context.
- The agent can explain the recommendation/evidence basis and record structured scientist feedback.
- Tools are allowlisted, schema-validated, attributable, and honest about unavailable lifecycle capabilities.
- Rescore/regeneration produces a reviewable proposal; no analysis or Accept/Reject state changes without explicit user action.
- Targeted tests plus lint/build pass, and audit records can reconstruct the conversation and any applied change.
