# Scoped Chat Continuity and Diagnostic Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resume persisted scoped chats, create clean auditable chats through commands or UI, and persist/tool-display diagnostic outcomes without leaking raw infrastructure errors.

**Architecture:** The opening route returns an owner-scoped persisted chat projection or creates a deliberately new snapshot-bound conversation. The message route persists a user message before execution and uses a new server-owned diagnostics ledger to capture all tool outcomes. The agent schedules validated independent calls concurrently, preserves dependent ordering and tool-message order, and exposes only normalized verification-note events to the client.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Supabase/Postgres RLS and `SECURITY DEFINER` RPCs, server-side OpenAI-compatible chat and SSE.

## Global Constraints

- Preserve immutable `TalkAboutContext` snapshots and never accept tool context, ownership, analysis ID, recommendation ID, or credentials from the browser/model as authority.
- The configured model remains open-weights through the existing OpenAI-compatible provider; do not add a proprietary fallback.
- Tool diagnostics are append-only, owner-readable only, and never directly browser-writable.
- Do not store secrets, authorization headers, raw provider prompts/responses, unbounded stacks, or raw internal errors in diagnostics or the UI.
- A first forwarded model `delta`, not activity/tool events, defines `ttft_ms`.
- Normal warm scoped-chat paths must yield first model text in <= 3,000 ms; do not increase timeouts before recorded stage evidence supports it.
- Chat remains read-only except for the pre-existing narrow recommendation-approval RPC; this work must not alter approval semantics.
- Preserve original tool call order in model tool messages even if calls complete concurrently.

---

### Task 1: Add append-only tool-run database ledger and typed repository boundary

**Files:**
- Create: `supabase/migrations/20260812000001_create_talk_tool_runs.sql`
- Modify: `lib/talk-about-this/repository.ts:1-299`
- Modify: `tests/lib/talk-about-this/repository.test.ts`

**Interfaces:**
- Produces `ToolRunStatus`, `ToolRunReasonCode`, `CreateToolRunInput`, `PersistedToolRun`, `createToolRun()`, and `linkToolRunsToAssistantMessage()` from `lib/talk-about-this/repository.ts`.
- `createToolRun(supabase, input)` invokes `record_scoped_tool_run(...)` and returns a typed row; it must not use direct `.insert()`.
- `linkToolRunsToAssistantMessage(supabase, input)` invokes `link_scoped_tool_runs_to_assistant_message(...)`; it can fill only matching, null assistant links.
- Later tasks use a generated `turnId`, persisted user/assistant message IDs, and these exact names.

- [ ] **Step 1: Write failing repository tests for server-RPC-only diagnostics**

Add tests that provide a mocked `supabase.rpc` and assert the exact RPC call names/arguments. Cover success, normalized values, and database errors:

```ts
it('records a bounded owner-scoped diagnostic through the RPC', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: [{ id: 'run-1', status: 'timed_out', reason_code: 'deadline_exceeded' }],
    error: null,
  })
  const result = await createToolRun({ rpc } as never, {
    conversationId: 'conversation-1',
    userMessageId: 'message-1',
    turnId: 'turn-1',
    providerRound: 0,
    callId: 'call-1',
    toolName: 'lookup_chem21_solvent',
    validatedArguments: { chemical: 'dichloromethane' },
    status: 'timed_out',
    reasonCode: 'deadline_exceeded',
    reasonDetail: 'The CHEM21 lookup did not finish before its deadline.',
    dispatchBudgetMs: 5000,
    startedAt: '2026-08-12T00:00:00.000Z',
    completedAt: '2026-08-12T00:00:05.000Z',
    elapsedMs: 5000,
    telemetry: {},
  })
  expect(result.status).toBe('timed_out')
  expect(rpc).toHaveBeenCalledWith('record_scoped_tool_run', expect.objectContaining({
    p_conversation_id: 'conversation-1',
    p_user_message_id: 'message-1',
    p_status: 'timed_out',
    p_reason_code: 'deadline_exceeded',
  }))
})
```

Also assert `linkToolRunsToAssistantMessage` calls the link RPC with turn ID and assistant message ID, and both helpers throw a bounded diagnostic persistence error when `error` is present.
Add a migration/RPC integration test which invokes both functions using an authenticated browser-role client and asserts permission denied, then invokes them through `createAdminClient()` with the authenticated route user ID and asserts success. The test must prove a direct authenticated browser call cannot fabricate an owned diagnostic row.

- [ ] **Step 2: Run the repository test to verify it fails**

Run: `npx vitest run tests/lib/talk-about-this/repository.test.ts`

Expected: FAIL because the tool-run types and repository functions do not exist.

- [ ] **Step 3: Create the migration with restrictive RLS and two narrow RPCs**

Create `20260812000001_create_talk_tool_runs.sql` with:

```sql
CREATE TABLE public.gpc_talk_tool_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.gpc_talk_conversations(id) ON DELETE CASCADE,
  analysis_id UUID NOT NULL REFERENCES public.gpc_analyses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_message_id UUID REFERENCES public.gpc_talk_messages(id) ON DELETE SET NULL,
  assistant_message_id UUID REFERENCES public.gpc_talk_messages(id) ON DELETE SET NULL,
  turn_id UUID NOT NULL,
  provider_round INTEGER NOT NULL CHECK (provider_round >= 0),
  call_id TEXT NOT NULL CHECK (char_length(call_id) BETWEEN 1 AND 200),
  tool_name TEXT NOT NULL CHECK (char_length(tool_name) BETWEEN 1 AND 100),
  validated_arguments JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'timed_out', 'cancelled', 'skipped_limit')),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('none', 'deadline_exceeded', 'client_cancelled', 'call_limit_exceeded', 'invalid_request', 'tool_error', 'diagnostic_write_failed')),
  reason_detail TEXT CHECK (reason_detail IS NULL OR char_length(reason_detail) <= 500),
  dispatch_budget_ms INTEGER CHECK (dispatch_budget_ms IS NULL OR dispatch_budget_ms >= 0),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  elapsed_ms INTEGER CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
  telemetry JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, turn_id, call_id)
);

ALTER TABLE public.gpc_talk_tool_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own talk tool runs"
  ON public.gpc_talk_tool_runs FOR SELECT USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.gpc_talk_tool_runs FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.record_scoped_tool_run FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_scoped_tool_runs_to_assistant_message FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_scoped_tool_run TO service_role;
GRANT EXECUTE ON FUNCTION public.link_scoped_tool_runs_to_assistant_message TO service_role;
CREATE INDEX idx_gpc_talk_tool_runs_conversation_created ON public.gpc_talk_tool_runs(conversation_id, created_at);
CREATE INDEX idx_gpc_talk_tool_runs_user_message ON public.gpc_talk_tool_runs(user_message_id);
CREATE INDEX idx_gpc_talk_tool_runs_assistant_message ON public.gpc_talk_tool_runs(assistant_message_id);
```

Define `record_scoped_tool_run(...) RETURNS SETOF public.gpc_talk_tool_runs` as `SECURITY DEFINER SET search_path = public`. It receives `p_user_id` solely from the server route’s authenticated session and must reject a null value, lock the requested conversation with `FOR SHARE`, require its `user_id = p_user_id`, derive `analysis_id` only from that conversation, verify that the supplied user message belongs to the same conversation/user and has role `user`, constrain status/reason/lengths/telemetry, insert one row, and return it. It must not accept an analysis ID. Do not use `auth.uid()` inside this service-role-only function.

Define `link_scoped_tool_runs_to_assistant_message(p_user_id UUID, p_conversation_id UUID, p_turn_id UUID, p_assistant_message_id UUID) RETURNS INTEGER` as `SECURITY DEFINER SET search_path = public`. It requires a non-null server-supplied owner ID, verifies/locks the matching owned conversation, verifies the assistant message belongs to that conversation/user and has role `assistant`, updates only rows matching conversation/turn/owner whose `assistant_message_id IS NULL`, and returns the update count. Revoke both RPCs from `anon`, `authenticated`, and `public`; grant `EXECUTE` only to `service_role`. The message route invokes them only through `createAdminClient()` after cookie-session authentication. A signed-in browser client must receive permission denied.

- [ ] **Step 4: Implement the typed repository boundary**

In `repository.ts`, define snake-case database shape separately from camel-case inputs. Keep status/reason types closed:

```ts
export type ToolRunStatus = 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'skipped_limit'
export type ToolRunReasonCode =
  | 'none' | 'deadline_exceeded' | 'client_cancelled' | 'call_limit_exceeded'
  | 'invalid_request' | 'tool_error' | 'diagnostic_write_failed'

export interface CreateToolRunInput {
  conversationId: string
  userMessageId: string
  turnId: string
  providerRound: number
  callId: string
  toolName: string
  validatedArguments: Record<string, unknown>
  status: ToolRunStatus
  reasonCode: ToolRunReasonCode
  reasonDetail?: string
  dispatchBudgetMs?: number
  startedAt?: string
  completedAt?: string
  elapsedMs?: number
  telemetry: Record<string, unknown>
}
```

Pass only closed-vocabulary, bounded data to `record_scoped_tool_run`; `reasonDetail` is either absent or a fixed reason-code-derived safe sentence, never an exception message. Reject invalid local inputs before calling RPC. `createToolRun` and `linkToolRunsToAssistantMessage` receive a server-created `createAdminClient()` instance plus the authenticated `userId`, and pass `p_user_id` to the RPC; they must never accept a browser client. For linking, return `0` when no rows are linkable, rather than treating it as an error. Do not add a client fetch endpoint for this ledger.

- [ ] **Step 5: Run focused tests and static type check**

Run: `npx vitest run tests/lib/talk-about-this/repository.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit the task**

```bash
git add supabase/migrations/20260812000001_create_talk_tool_runs.sql lib/talk-about-this/repository.ts tests/lib/talk-about-this/repository.test.ts
git commit -m "feat: persist scoped chat tool diagnostics"
```

### Task 2: Hydrate or deliberately create conversations through the opening route

**Files:**
- Modify: `lib/talk-about-this/repository.ts:67-112,282-299`
- Modify: `app/api/talk-about-this/route.ts:1-58`
- Modify: `tests/lib/talk-about-this/repository.test.ts`
- Modify: `tests/lib/talk-about-this/messages-route.test.ts`

**Interfaces:**
- Consumes `TalkMessage`, `PersistedRecommendationApprovalReceipt`, and `StoredLiteratureCitation` from the repository.
- Produces `PersistedChatMessage`, `PersistedEvidenceReceipt`, `conversationHistoryForUi()`, and `OpenConversationResponse` from the open route.
- `POST /api/talk-about-this` accepts `{ analysisId: string; scope: unknown; newConversation?: boolean }`.
- A later client task uses `disposition`, `messages`, `evidenceReceipts`, and `approvalReceipt` from this response.

- [ ] **Step 1: Write failing route and projection tests**

Add tests asserting:

```ts
expect(response.status).toBe(200)
expect(await response.json()).toMatchObject({
  conversationId: 'existing-conversation',
  disposition: 'resumed',
  messages: [{ role: 'user', content: 'Is this significant?' }],
})
```

Add a `newConversation: true` test that asserts the context-hash lookup is not called, `createConversation` is called, the response is `201`, `disposition` is `created`, and `messages`/`evidenceReceipts` are empty. Add a malformed `newConversation: 'yes'` request expecting 400. Test a complete round trip from a persisted `StoredLiteratureCitation` through `conversationHistoryForUi()`/`evidenceReceiptsForUi()`, the opening response, and client hydration. The exact shared evidence DTO/validator must either carry a finite `similarity` or remove it from the client receipt contract; no valid stored receipt may be silently discarded.

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `npx vitest run tests/lib/talk-about-this/repository.test.ts tests/lib/talk-about-this/messages-route.test.ts`

Expected: FAIL because opening responses have no history/disposition and do not validate `newConversation`.

- [ ] **Step 3: Add the UI-safe persisted history projection**

In the repository, add:

```ts
export interface PersistedChatMessage {
  id: string
  role: TalkMessage['role']
  content: string
  citations: string[]
  status: TalkMessage['status']
  ttftMs: number | null
  createdAt: string
}

export interface PersistedEvidence {
  id: string
  sourceDocumentId: string
  doi?: string
  title: string
  pageStart: number
  pageEnd: number
  quote: string
  similarity: number
  applicability?: string
  limitations?: string
  candidateStatus: string
}

export interface PersistedEvidenceReceipt {
  evidence: PersistedEvidence
  receivedAt: string
}
```

Move the structural validator for this DTO into a shared non-client module and use it in the repository projection and `TalkAboutThis`. `StoredLiteratureCitation` must be expanded to retain finite `similarity`; old stored citations lacking it are not rendered as evidence receipts. `listConversationMessages` must define canonical ordering as `.order('created_at', { ascending: true }).order('id', { ascending: true })`; use this exact ordering for reopening and the model’s history. Test equal `created_at` values to prove stable ID tie-breaking.

`conversationHistoryForUi(messages)` must return this canonically ordered history with only citation IDs safe for the current renderer. `evidenceReceiptsForUi(messages)` must extract only structurally valid `StoredLiteratureCitation` entries, deduplicate by evidence ID, and use the source assistant message `created_at` as `receivedAt`. It must never forward telemetry JSON or failure reasons to the browser.

- [ ] **Step 4: Extend the opening route without weakening ownership**

Parse `newConversation` as a boolean when supplied; reject any other value. Build context exactly as now. Use `findOwnedConversationByContextHash` only when `newConversation` is false. After selecting/creating, call `listConversationMessages`, `conversationHistoryForUi`, `evidenceReceiptsForUi`, and `loadOwnedRecommendationApprovalReceipt` with the authenticated user/conversation. Return:

```ts
return NextResponse.json({
  conversationId: conversation.id,
  scope: conversation.scope,
  contextHash: conversation.context_hash,
  noDirectEvidence: context.noDirectEvidence,
  disposition: existingConversation ? 'resumed' : 'created',
  messages: conversationHistoryForUi(messages),
  evidenceReceipts: evidenceReceiptsForUi(messages),
  approvalReceipt,
}, { status: existingConversation ? 200 : 201 })
```

A message list failure must fail the opening request, not return a misleading empty resumed transcript.

- [ ] **Step 5: Run focused tests and static type check**

Run: `npx vitest run tests/lib/talk-about-this/repository.test.ts tests/lib/talk-about-this/messages-route.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit the task**

```bash
git add lib/talk-about-this/repository.ts app/api/talk-about-this/route.ts tests/lib/talk-about-this/repository.test.ts tests/lib/talk-about-this/messages-route.test.ts
git commit -m "feat: resume and restart scoped chat conversations"
```

### Task 3: Schedule tools safely and emit normalized diagnostic events

**Files:**
- Modify: `lib/talk-about-this/agent.ts:15-430`
- Modify: `lib/talk-about-this/latency.ts:1-27`
- Modify: `tests/lib/talk-about-this/agent.test.ts`
- Modify: `tests/lib/talk-about-this/latency.test.ts`

**Interfaces:**
- Consumes `CreateToolRunInput` semantics from Task 1 but does not call Supabase directly.
- Extends `ScopedToolChatRequest` with `turnId: string`, `onToolRun: (input: Omit<CreateToolRunInput, 'conversationId' | 'userMessageId'>) => Promise<void>`, and immutable tool-call scheduler helpers.
- Produces `tool-failed` event data with `reasonCode`, `userNote`, `status`, and `source`; never emits raw error reasons to the client.
- Later message-route task supplies `onToolRun` and persists calls through Task 1’s repository.

- [ ] **Step 1: Write failing scheduler and error-redaction tests**

Use deferred promises and fake `now()` to prove behavior rather than elapsed wall time:

```ts
it('runs independent valid calls concurrently but serializes PubChem before dependent RDKit', async () => {
  const order: string[] = []
  const executeTool = vi.fn(async call => {
    order.push(`start:${call.name}`)
    if (call.name === 'lookup_pubchem_profile') await pubChemDeferred.promise
    order.push(`end:${call.name}`)
    return resultFor(call)
  })
  // provider emits CHEM21, PubChem, RDKit-dependent calls in one tool round
  await runScopedToolChat(request({ executeTool }))
  expect(order).toContain('start:lookup_chem21_solvent')
  expect(order.indexOf('start:calculate_rdkit_properties')).toBeGreaterThan(order.indexOf('end:lookup_pubchem_profile'))
})
```

Add tests that duplicate identical validated calls execute `executeTool` once but create two diagnostic callbacks (second contains `telemetry.deduplicatedFromCallId`), that a fourth call gets `skipped_limit`/`call_limit_exceeded`, that expiry gives `timed_out`/`deadline_exceeded`, and that arbitrary token-bearing thrown text never appears in the RPC diagnostic input or any SSE event/user note. Add same-round PubChem plus `screen_solvent_candidates` and non-density `lookup_experimental_solvent_evidence` cases; each must defer full validation until PubChem yields canonical SMILES. Add a tool that resolves after a client abort and assert no completed result/tool-complete event reaches the model.

Assert tool messages passed to provider are ordered by original `call.id`, not resolution order. Assert first `delta` behavior is unchanged in `firstForwardedDeltaMs` tests.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npx vitest run tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/latency.test.ts`

Expected: FAIL because execution is serial, duplicate calls execute repeatedly, and tool failures have no normalized status/note schema.

- [ ] **Step 3: Extract closed diagnostic classification and safe activity mapping**

In `agent.ts`, create pure helpers:

```ts
interface ToolDiagnostic {
  status: ToolRunStatus
  reasonCode: ToolRunReasonCode
  reasonDetail?: string
  userNote: string
}

function diagnosticForFailure(input: {
  tool: ToolName
  source: string
  abortReason: 'deadline' | 'client' | null
  skippedForLimit?: boolean
}): ToolDiagnostic
```

Return only the four approved user-facing messages. `reasonDetail` is either omitted or selected from a fixed safe map keyed by `reasonCode`; never derive it from an exception. Use `sourceLabels`-compatible source identifiers (`CHEM21`, `PubChem GHS`, `local evidence`, `scoped literature evidence`) in user notes. Log arbitrary original error values only to the server’s protected runtime logger with conversation/turn/call correlation—not to Supabase or SSE.

- [ ] **Step 4: Implement deterministic validation, deduplication, and dependency waves**

Before executing a provider round’s calls:

1. enumerate calls in original order;
2. reject calls beyond `MAX_TOOL_CALLS_PER_TURN` with a `failureResult`, a `skipped_limit` diagnostic, and `tool-failed` event;
3. perform only syntax, allowed-name, argument-shape, and immutable-scope validation on remaining calls. Record syntax/scope invalidity as `failed`/`invalid_request`; do not require canonical SMILES in this pass;
4. fingerprint these prevalidated calls using recursively key-sorted JSON of `{ name, normalizedArguments }`;
5. identify canonical-SMILES-dependent calls (`screen_solvent_candidates` and non-density `lookup_experimental_solvent_evidence`) by requested solute. Run independent calls and prerequisite PubChem calls concurrently in the first wave. Ingest successful canonical SMILES. Only then fully validate, fingerprint, and dispatch dependent calls in the next wave. If PubChem is unavailable or lacks canonical SMILES, return an unavailable tool result with `failed`/`tool_error`, not `invalid_request`;
6. execute each wave with `Promise.all` and a per-call `AbortSignal.timeout(Math.min(TOOL_CALL_TIMEOUT_MS, remainingMs))` combined with cancellation. Check the combined signal immediately before and immediately after `executeTool`; if it was aborted after return, discard the result and classify by its originating timeout versus client-abort signal;
7. for duplicates, wait for and reuse the first identical fully valid result while emitting a separate diagnostic entry; and
8. append `conversation.push({ role: 'tool', ... })` exactly in original request order after all result slots are resolved.

Use `performance.now()` for elapsed timing and `new Date().toISOString()` for persisted time fields. Keep the one-loop 12,000 ms deadline. Do not convert tool failure into a citation or `tool-complete` event.

- [ ] **Step 5: Emit bounded scheduling telemetry and retain true TTFT**

Extend `ChatLatencyTelemetry` with:

```ts
scheduling?: {
  requestedCount: number
  dispatchedCount: number
  deduplicatedCount: number
}
```

Aggregate no more than five retrieval attempts as today. Record every tool-run diagnostic callback before moving to the next model pass; if the callback rejects, write a server-safe log and continue. Keep only `delta` events eligible for `firstForwardedDeltaMs`.

- [ ] **Step 6: Run focused tests and static type check**

Run: `npx vitest run tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/latency.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit the task**

```bash
git add lib/talk-about-this/agent.ts lib/talk-about-this/latency.ts tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/latency.test.ts
git commit -m "feat: bound and diagnose scoped chat tool scheduling"
```

### Task 4: Persist tool diagnostics at the message-route boundary

**Files:**
- Modify: `app/api/talk-about-this/[conversationId]/messages/route.ts:1-290`
- Modify: `lib/talk-about-this/repository.ts:259-299`
- Modify: `tests/lib/talk-about-this/messages-route.test.ts`

**Interfaces:**
- Consumes Task 1 repository RPC helpers and Task 3 `onToolRun` callback contract.
- Produces SSE tool events containing only safe `callId`, `tool`, `status`, `reasonCode`, `source`, and `userNote` for failures.
- Preserves `assistantMessageCitations` and its safe latency metadata.

- [ ] **Step 1: Write failing route lifecycle tests**

Mock `createMessage`, `createToolRun`, `linkToolRunsToAssistantMessage`, and `runScopedToolChat`. Assert that:

```ts
expect(createMessage).toHaveBeenNthCalledWith(1, expect.anything(), 'user-1', 'conversation-1', expect.objectContaining({ role: 'user' }))
expect(createToolRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
  conversationId: 'conversation-1',
  userMessageId: 'persisted-user-message',
  turnId: expect.any(String),
}))
expect(linkToolRunsToAssistantMessage).toHaveBeenCalledWith(expect.anything(), {
  conversationId: 'conversation-1',
  turnId: expect.any(String),
  assistantMessageId: 'persisted-assistant-message',
})
```

Add cases for a timed-out tool, a cancelled request, diagnostic-RPC failure, and terminal assistant-message persistence rejection. Parse the SSE and assert no raw internal diagnostic detail is present. For terminal persistence rejection, assert a generic terminal error plus `done` are emitted, the stream closes, and no link RPC occurs.

- [ ] **Step 2: Run focused route tests to verify failure**

Run: `npx vitest run tests/lib/talk-about-this/messages-route.test.ts`

Expected: FAIL because user-message IDs are discarded, no tool ledger is written, and diagnostics cannot be linked.

- [ ] **Step 3: Persist the inbound message and generate one response turn ID**

Change the user-message persistence call to capture `const userMessage = await createMessage(...)`. Generate `const turnId = crypto.randomUUID()` after it succeeds. Pass both into the `runScopedToolChat` request. Do this only on normal model requests; preserve the existing explicit approval path unchanged.

- [ ] **Step 4: Add a fail-open diagnostic persistence callback**

Pass:

```ts
onToolRun: async input => {
  try {
    await createToolRun(createAdminClient(), user.id, {
      ...input,
      conversationId,
      userMessageId: userMessage.id,
    })
  } catch {
    console.error('Scoped chat tool diagnostic persistence failed', {
      conversationId,
      turnId,
      callId: input.callId,
      toolName: input.toolName,
    })
  }
},
```

Keep this failure out of the SSE response and scientific answer. In `onEvent`, apply `activityPayload` to both complete and failed tool events. Modify `activityPayload` to whitelist `reasonCode` and `userNote`; omit `reason`, `reasonDetail`, and raw telemetry except the already validated timing projection. Include bounded final scheduling telemetry in the terminal `done` event and assistant persisted telemetry.

Persist the terminal assistant message inside an inner `try/catch/finally`. On persistence failure, log only `conversationId`, `turnId`, and a fixed event name; emit an SSE `error` with `Chat response could not be saved.` and terminal `done` with failed status, then close the controller. Never expose a database error.

When assistant persistence succeeds, call `linkToolRunsToAssistantMessage(createAdminClient(), user.id, { conversationId, turnId, assistantMessageId: assistantMessage.id })`; log link failure with only correlation identifiers. Do not link when assistant persistence fails. In all cases, the outer `finally` must send one terminal `done` event and invoke `controller.close()` exactly once, including cancellation.

- [ ] **Step 6: Run focused tests and static type check**

Run: `npx vitest run tests/lib/talk-about-this/messages-route.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit the task**

```bash
git add app/api/talk-about-this/[conversationId]/messages/route.ts lib/talk-about-this/repository.ts tests/lib/talk-about-this/messages-route.test.ts
git commit -m "feat: record scoped chat tool outcomes"
```

### Task 5: Resume visible transcripts, add new-chat controls, and render verification notes

**Files:**
- Modify: `components/TalkAboutThis.tsx:1-598`
- Modify: `tests/lib/talk-about-this/activity.test.ts`
- Modify: `tests/lib/talk-about-this/page-state.test.ts`

**Interfaces:**
- Consumes Task 2 `OpenConversationResponse`: `disposition`, `messages`, `evidenceReceipts`, and `approvalReceipt`.
- Consumes Task 4 safe tool-failed event fields: `tool`, `status`, `reasonCode`, `source`, and `userNote`.
- Produces exported pure helpers `isNewConversationCommand()`, `verificationNoteFromEvent()`, and `groupVerificationNotes()` to support deterministic tests.

- [ ] **Step 1: Write failing pure-helper and rendering-state tests**

Add focused tests:

```ts
expect(isNewConversationCommand(' /new ')).toBe(true)
expect(isNewConversationCommand('/clear')).toBe(true)
expect(isNewConversationCommand('/clear later')).toBe(false)
expect(verificationNoteFromEvent('tool-failed', {
  tool: 'lookup_chem21_solvent',
  status: 'timed_out',
  source: 'CHEM21',
  reasonCode: 'deadline_exceeded',
  userNote: 'Couldn’t verify CHEM21 data before the response deadline.',
})).toEqual({ source: 'CHEM21', reasonCode: 'deadline_exceeded', text: 'Couldn’t verify CHEM21 data before the response deadline.' })
```

Assert raw `reason`/`reasonDetail` values are discarded, same-source/same-reason notes group to one entry with a count, and a resumed server payload seeds all persisted messages/evidence/approval receipt. Add an Enter-vs-Shift+Enter keyboard handler test in the existing SSR/rendering-compatible harness; it must verify only Enter invokes the submit request and Shift+Enter does not.

- [ ] **Step 2: Run client-state tests to verify failure**

Run: `npx vitest run tests/lib/talk-about-this/activity.test.ts tests/lib/talk-about-this/page-state.test.ts`

Expected: FAIL because no command/note helpers, hydration state, or composer keyboard handler exist.

- [ ] **Step 3: Add safe client state and opening/hydration behavior**

Replace the client-only `ChatMessage` shape with Task 2’s UI projection or a structurally identical local shape carrying stable `id`, `status`, `createdAt`, and safe citation IDs. Add state:

```ts
const [conversationDisposition, setConversationDisposition] = useState<'created' | 'resumed' | null>(null)
const [verificationNotes, setVerificationNotes] = useState<VerificationNote[]>([])
```

Refactor `openConversation(newConversation = false)` to send `{ analysisId, scope, newConversation }`, parse/validate the complete response, and update all local conversation/message/evidence/receipt state only after a successful response. For `newConversation: true`, keep current transcript and draft on request failure; after success clear draft, activities, error, and verification notes. Never clear an existing transcript before a resume response validates.

- [ ] **Step 4: Implement `/new`, `/clear`, keyboard, and explicit New chat behavior**

At the start of `sendMessage`, detect exact trimmed commands. If it is a command, call `openConversation(true)` and return before appending local messages or sending `/messages`.

On the textarea add `onKeyDown`:

```tsx
onKeyDown={event => {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  if (!isSending && draft.trim()) event.currentTarget.form?.requestSubmit()
}}
```

Add a header button:

```tsx
<button type="button" onClick={() => void openConversation(true)} disabled={isStarting || isSending}>
  New chat
</button>
```

Leave Esc/Stop semantics unchanged. Disable composer submission while streaming. Focus the textarea after opening via the existing open-state focus effect.

- [ ] **Step 5: Render status and grouped verification notes accessibly**

In the dialog header, render `New scoped chat` when `disposition === 'created'` and `Resumed chat` when `disposition === 'resumed'`. Use `aria-live="polite"` for the status.

Convert every safe `tool-failed` SSE event with `verificationNoteFromEvent`, group by `${source}:${reasonCode}`, and render after activity:

```tsx
<details className="rounded-lg border p-3 text-xs" aria-label="Verification notes">
  <summary>Verification notes ({groupedNotes.length})</summary>
  {groupedNotes.map(note => <p key={`${note.source}:${note.reasonCode}`}>{note.text}{note.count > 1 ? ` (${note.count} lookups)` : ''}</p>)}
</details>
```

Do not use the raw `activity.detail` for errors. Keep success activity visible. The disclosure is present only after there is at least one grouped note and remains visible after stream completion.

- [ ] **Step 6: Run focused tests and static type check**

Run: `npx vitest run tests/lib/talk-about-this/activity.test.ts tests/lib/talk-about-this/page-state.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit the task**

```bash
git add components/TalkAboutThis.tsx tests/lib/talk-about-this/activity.test.ts tests/lib/talk-about-this/page-state.test.ts
git commit -m "feat: resume and restart scoped chats in the UI"
```

### Task 6: Enforce answer provenance and run release verification

**Files:**
- Modify: `lib/talk-about-this/prompt.ts`
- Modify: `tests/lib/talk-about-this/prompt.test.ts`
- Modify: `BACKLOG.md`
- Modify: `docs/superpowers/specs/2026-08-12-scoped-chat-continuity-observability-design.md`

**Interfaces:**
- Consumes normalized unavailable `ToolResult` data already supplied in model tool messages by Task 3.
- Produces an explicit prompt rule preventing unavailable tool results from supporting a scientific claim.
- Does not create any model-provider configuration or fallback.

- [ ] **Step 1: Write a failing provenance-prompt contract test**

Add an assertion against `buildTalkAboutSystemPrompt(...)` that requires all of the following language-level policy fragments:

```ts
expect(prompt).toContain('An unavailable, timed out, cancelled, skipped, or failed tool result is not evidence')
expect(prompt).toContain('State whether a claim comes from the immutable scoped analysis or a completed tool result')
expect(prompt).toContain('Do not cite or imply verification from unavailable tool results')
```

- [ ] **Step 2: Run the prompt test to verify failure**

Run: `npx vitest run tests/lib/talk-about-this/prompt.test.ts`

Expected: FAIL because the exact unavailable-tool provenance rule is absent.

- [ ] **Step 3: Add the compact source-of-truth instruction to the system prompt**

Add one dedicated prompt paragraph stating exactly:

> An unavailable, timed out, cancelled, skipped, or failed tool result is not evidence. Do not cite it, attribute a conclusion to it, or imply it verified anything. State whether each material claim comes from the immutable scoped analysis or a completed tool result; if independent verification was unavailable, say so plainly.

Do not modify context scope, citation schema, or tool availability.

- [ ] **Step 4: Run the full deterministic verification suite**

Run: `npm test && npm run build`

Expected: PASS.

- [ ] **Step 5: Apply migration and execute an authenticated configured smoke test**

Run the migration with the linked project only after reviewing the generated SQL:

```bash
supabase db push --linked
supabase migration list --linked
```

Then, with configured open-weights OpenAI-compatible provider, embeddings, Supabase, and chemistry service:

1. Open a recommendation-scoped chat, submit the DCM→ethyl acetate question, and wait for completion.
2. Close/reopen; confirm the transcript, evidence receipts, approval receipt, and friendly verification notes persist.
3. Submit `/new`; confirm a different conversation ID, an empty visible transcript, and retained history in the original conversation.
4. Use a controlled tool timeout; confirm one friendly verification note and one owner-authorized `gpc_talk_tool_runs` row with `timed_out`/`deadline_exceeded`.
5. Execute three authenticated warm representative requests; record the first forwarded model delta for each and require all `<= 3000 ms`.

If any external prerequisite is unavailable, record the exact missing service/configuration and do not mark the latency gate passed.

- [ ] **Step 6: Update durable release tracking after successful smoke test**

Mark the precise backlog item in `BACKLOG.md` done only after all deterministic tests, migration verification, authenticated smoke steps, and warm TTFT gate pass. Update the design spec’s status to `Implemented and verified` only with the same evidence. Do not claim completion for unavailable external smoke prerequisites.

- [ ] **Step 7: Commit the task**

```bash
git add lib/talk-about-this/prompt.ts tests/lib/talk-about-this/prompt.test.ts BACKLOG.md docs/superpowers/specs/2026-08-12-scoped-chat-continuity-observability-design.md
git commit -m "docs: verify scoped chat continuity release"
```

## Self-review

- **Conversation retention:** Task 2 returns owner-scoped chronological message/evidence/receipt data; Task 5 hydrates it. Task 2’s explicit `newConversation` mode and Task 5 command/button path preserve prior conversations rather than visually clearing a still-active model context.
- **Keyboard and UI:** Task 5 covers Enter, Shift+Enter, stream lock, controls, focus, open errors, status copy, and merged verification notes.
- **Root-cause/latency:** Task 3 corrects the demonstrated serial deadline behavior through fingerprint deduplication and bounded concurrency without extending timeouts. Task 4 captures failures durably. Task 6 defines the real warm <=3,000 ms gate.
- **Diagnostics/security:** Task 1 defines an append-only owner-readable table, revokes direct writes, and uses ownership-validating RPCs. Task 4 prevents ledger failure from altering scientific response behavior. Task 5 cannot render raw diagnostic details.
- **Scientific integrity:** Task 6 prevents failed-tool claims/citations. Tasks 3–4 continue to provide unavailable results to the model without fabricating source evidence.
- **Type consistency:** `CreateToolRunInput`, `ToolRunStatus`, `ToolRunReasonCode`, `PersistedChatMessage`, `PersistedEvidenceReceipt`, `turnId`, `newConversation`, `onToolRun`, and safe failure event names are defined before their consuming tasks.
- **Placeholder scan:** No TODO/TBD, “appropriate error handling,” or cross-task implementation shorthand remains.
