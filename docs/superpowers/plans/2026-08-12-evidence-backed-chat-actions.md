# Evidence-backed Chat Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import page-bounded CRGSC evidence into Supabase, use it to ground recommendations and scoped chat, and persist an exact, auditable recommendation approval when a scientist sends “approve this” in a stable recommendation-scoped conversation.

**Architecture:** `literature_source_documents` and `literature_evidence_units` become the sole literature source for both Phase 2.5 and Phase 2.7. Chat retrieval is an abortable server-only tool; its structured evidence citations travel from tool result through agent, SSE, message persistence, and UI. Approval is not model tool use: the route recognizes a narrow direct request and calls one `SECURITY DEFINER` RPC that locks and changes only the snapshot-bound recommendation, writes its receipt in the same transaction, and advances analysis revision.

**Tech Stack:** Next.js 16 App Router, TypeScript, Vitest, Python 3, OpenAI embeddings (`text-embedding-3-small`), Supabase/Postgres with pgvector/RLS/PLpgSQL, existing Qwen/OpenAI-compatible SSE chat provider, existing structured recommendation re-evaluator.

## Global Constraints

- Use `literature_evidence_units`; do not populate, query, or extend `literature_precedents` in recommendation or chat flows.
- Candidate status is an immutable fact: `candidate_pending_adjudication` remains **Candidate evidence** in import data, prompts, output, saved citations, and UI. It is never described as validated support.
- Scoped chat remains Qwen/open-weights through `CHAT_LLM_*`; no proprietary fallback is introduced for chat. The existing non-chat pipeline re-evaluator remains its current provider until separately migrated; its new evidence input is page-bounded and status-labelled.
- Server-only tools accept neither browser/model-controlled target IDs nor arbitrary network/SQL/credentials. Literature query ≤500 characters, controlled signal groups only, maximum five matches, and abort signal propagated to embedding/RPC transport.
- A stable `Recommendation.id` is mandatory for an approval-capable conversation. Index-scoped conversations remain read-only and never advertise or accept direct approval.
- Conversation `analysis_id`, `scope`, `context_snapshot`, and `context_hash` are immutable after creation. No client can insert or modify approval receipts.
- Only the precise direct messages `approve this`, `accept this`, `approve this recommendation`, and `accept this recommendation` (case/terminal punctuation insensitive) invoke approval. Questions, negations, conditions, and mixed requests remain read-only chat.
- The approval RPC updates only the locked, current matching recommendation and inserts an append-only receipt in one transaction. It increments `gpc_analyses.revision_number`; browser PATCH uses compare-and-swap so stale UI writes cannot erase chat approval.
- SSE emits activity before retrieval. `ttft_ms` is the first forwarded model text chunk, never synthetic activity or completed-answer time. A representative warm retrieval chat must show a true first delta ≤3,000 ms; otherwise release is no-go.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/literature/import_evidence_units_supabase.py` | Validates, checkpoints, and batch-upserts canonical sources/evidence units. |
| `scripts/literature/test_import_evidence_units_supabase.py` | Offline importer validation/resume tests. |
| `lib/literature-evidence.ts` | Abortable server-only embedding/RPC retrieval and citation conversion. |
| `tests/lib/literature-evidence.test.ts` | Retrieval input, abort, provenance, and result-shaping tests. |
| `lib/pipeline.ts`, `lib/prompts/reevaluate.ts` | Replace both article-level retrieval paths and format status-labelled evidence units. |
| `lib/talk-about-this/tools.ts` | Typed literature lookup definition, result, and executor. |
| `lib/talk-about-this/agent.ts` | Parses bounded calls, streams real text chunks, and returns dynamic citations. |
| `lib/talk-about-this/actions.ts` | Recognizes exact approval language and invokes the transactional RPC. |
| `lib/talk-about-this/context.ts`, `repository.ts` | Stable scope/context handling and revision-aware persistence types. |
| `app/api/talk-about-this/[conversationId]/messages/route.ts` | Coordinates agent result, evidence citation persistence, direct approval, and SSE. |
| `app/api/analyses/[id]/route.ts`, `app/analyze/[id]/page.tsx` | Revision-aware read/PATCH to prevent stale replacement. |
| `components/TalkAboutThis.tsx`, `AnalysisResults.tsx`, `FinalizedProtocol.tsx` | Render page-bound evidence/action receipts and reconcile server-approved UI state. |
| `supabase/migrations/20260812000000_secure_talk_actions.sql` | Makes conversation scope immutable; creates transactional approval RPC and receipts. |

## Task 1: Add abortable evidence-unit retrieval

**Files:**
- Create: `lib/literature-evidence.ts`
- Create: `tests/lib/literature-evidence.test.ts`
- Modify: `lib/types.ts`

**Interfaces:**

```ts
export type EvidenceSignalGroup = 'comparison' | 'process' | 'outcome' | 'hazard'
export interface LiteratureEvidenceMatch {
  id: string; sourceDocumentId: string; doi?: string; title: string
  pageStart: number; pageEnd: number; quote: string; evidenceType?: string
  applicability?: string; limitations?: string; candidateStatus: string; similarity: number
}
export function searchLiteratureEvidence(input: {
  query: string; limit: number; threshold: number; signalGroups?: EvidenceSignalGroup[]; signal?: AbortSignal
}): Promise<LiteratureEvidenceMatch[]>
export function citationFromEvidenceMatch(match: LiteratureEvidenceMatch): Citation
```

- [ ] **Step 1: Write failing retrieval tests**

```ts
it('embeds a bounded query and returns page-bounded candidate evidence', async () => {
  const matches = await searchLiteratureEvidence({ query: 'replace DMF with ethyl acetate', limit: 5, threshold: 0.25, signalGroups: ['comparison'] })
  expect(matches).toEqual([expect.objectContaining({ id: 'doi:p2:u1', pageStart: 2, pageEnd: 2, candidateStatus: 'candidate_pending_adjudication' })])
  expect(mockRpc).toHaveBeenCalledWith('match_literature_evidence_units', expect.objectContaining({ match_count: 5, requested_visibility: 'public', filter_signal_groups: ['comparison'] }))
})
it.each(['', 'x'.repeat(501)])('rejects invalid query %j before embedding', query =>
  expect(searchLiteratureEvidence({ query, limit: 5, threshold: 0.25 })).rejects.toThrow('query'))
it('propagates caller abort to embedding/RPC and rejects without a fabricated source', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(searchLiteratureEvidence({ query: 'DMF comparison', limit: 5, threshold: 0.25, signal: controller.signal })).rejects.toThrow(/abort/i)
})
```

Cover limit 0/6, unsupported signal group, malformed RPC row, zero match, RPC error, and citation output containing evidence-unit ID plus `pp. start–end`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- tests/lib/literature-evidence.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the retrieval boundary**

Validate `query.trim()` (1–500), integer `limit` (1–5), and groups against the four literals before creating embeddings. Create `text-embedding-3-small` embeddings server-side, call `match_literature_evidence_units` with `requested_visibility: 'public'`, and map only complete rows. `shapeEvidenceMatch` rejects missing ID/title/quote/status, nonpositive pages, `pageEnd < pageStart`, or nonfinite similarity. `citationFromEvidenceMatch` uses the evidence unit as `source_id` and includes title/DOI/pages.

Pass the optional abort signal to the embedding client if the SDK supports it; otherwise wrap embedding and RPC calls in an abort-aware `Promise.race` which stops awaiting result after the caller’s abort. No result is returned after abort.

- [ ] **Step 4: Run retrieval tests**

Run: `npm test -- tests/lib/literature-evidence.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit retrieval boundary**

```bash
git add lib/literature-evidence.ts lib/types.ts tests/lib/literature-evidence.test.ts
git commit -m "feat: retrieve abortable literature evidence units"
```

## Task 2: Import CRGSC source documents and evidence units

**Files:**
- Create: `scripts/literature/import_evidence_units_supabase.py`
- Create: `scripts/literature/test_import_evidence_units_supabase.py`
- Modify: `.env.local.example`, `.gitignore`

**Interfaces:**

```text
python3 scripts/literature/import_evidence_units_supabase.py \
  --article-index data/literature/crgsc/extracted-v5/article-index.jsonl \
  --evidence data/literature/crgsc/candidate-evidence-units-v5.jsonl \
  --embeddings data/literature/crgsc/evidence-embeddings-v5.jsonl \
  --manifest data/literature/crgsc/import-v5-manifest.json
```

It requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; it produces an atomic checksum manifest and never prints credentials.

- [ ] **Step 1: Write failing importer tests**

```py
def test_build_import_batches_rejects_orphan_and_missing_embedding():
    sources = {"doc-1": {"canonical_id": "doc-1", "title": "Article", "status": "canonical", "document_type": "research_article"}}
    unit = {"evidence_unit_id": "missing:p1:u0", "document_id": "missing", "title": "Article", "page_start": 1, "page_end": 1, "quote": "A sufficiently long quote.", "signal_groups": []}
    with pytest.raises(ValueError, match="source document"):
        build_import_batches(sources, [unit], {})

def test_batch_preserves_candidate_status_pages_and_embedding_model():
    documents, units = build_import_batches(*fixture_records())
    assert units[0]["candidate_status"] == "candidate_pending_adjudication"
    assert (units[0]["page_start"], units[0]["page_end"], units[0]["embedding_model"]) == (2, 2, "text-embedding-3-small")
```

Cover invalid page range, duplicate IDs, 1536-dimension requirement, failed batch leaves incomplete manifest, resume after last successful ID, checksum mismatch rejection, and rerun payload excludes completed IDs.

- [ ] **Step 2: Run Python test and confirm failure**

Run: `python3 -m pytest scripts/literature/test_import_evidence_units_supabase.py -q`

Expected: FAIL because the importer does not exist.

- [ ] **Step 3: Implement validation, resumability, and upsert**

Read canonical `research_article` rows from the article index. Join evidence and embeddings by IDs. Require known canonical source, title, `1 <= page_start <= page_end`, quote, list signal groups, exactly one 1536-value vector, and embedding model. Batch REST upserts keyed by deterministic source/evidence IDs using:

```py
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}
session.post(f"{url}/rest/v1/literature_source_documents?on_conflict=id", json=documents, headers=headers, timeout=30)
session.post(f"{url}/rest/v1/literature_evidence_units?on_conflict=id", json=units, headers=headers, timeout=30)
```

Atomically rewrite the manifest after every successful evidence batch. It records SHA-256 for all inputs, completed unit ID, source/unit/batch counts, and `complete: false`; set `complete: true` only after all 2xx batches. On resume, reject checksum change before network I/O. Add the service-role variable empty to `.env.local.example`; ignore generated embeddings and manifest unless the repository’s data policy intentionally tracks the small manifest.

- [ ] **Step 4: Run importer tests**

Run: `python3 -m pytest scripts/literature/test_import_evidence_units_supabase.py -q`

Expected: PASS.

- [ ] **Step 5: Embed, migrate, import, and check remote evidence**

Run:

```bash
python3 scripts/literature/embed_evidence_units_openai.py --input data/literature/crgsc/candidate-evidence-units-v5.jsonl --output data/literature/crgsc/evidence-embeddings-v5.jsonl --model text-embedding-3-small --batch-size 64
supabase db push --linked
python3 scripts/literature/import_evidence_units_supabase.py --article-index data/literature/crgsc/extracted-v5/article-index.jsonl --evidence data/literature/crgsc/candidate-evidence-units-v5.jsonl --embeddings data/literature/crgsc/evidence-embeddings-v5.jsonl --manifest data/literature/crgsc/import-v5-manifest.json
```

Call `searchLiteratureEvidence()` with a known corpus phrase. Verify returned source ID, quote, pages, candidate status, and count against the manifest.

- [ ] **Step 6: Commit importer code**

```bash
git add scripts/literature/import_evidence_units_supabase.py scripts/literature/test_import_evidence_units_supabase.py .env.local.example .gitignore
git commit -m "feat: import canonical literature evidence units"
```

## Task 3: Migrate all recommendation evidence paths

**Files:**
- Modify: `lib/pipeline.ts:9,441-495,814-869`
- Modify: `lib/prompts/reevaluate.ts`
- Modify: `tests/lib/pipeline-ranking.test.ts`
- Modify: `tests/lib/reevaluation.test.ts`

**Interfaces:**
- Every prior `SearchResult[]` in Phase 2.5 and Phase 2.7 becomes `LiteratureEvidenceMatch[]`.
- Phase 2.5 attaches no more than three distinct `citationFromEvidenceMatch()` values.
- `buildReevaluatePrompt(recommendation, matches)` includes only page-bounded quote, DOI/title/page range, candidate status, applicability, and limitations.

- [ ] **Step 1: Write failing Phase 2.5 and Phase 2.7 tests**

```ts
it('attaches a page-bounded candidate citation in Phase 2.5', async () => {
  mockEvidenceSearch.mockResolvedValue([candidateMatch('doi:p4:u2')])
  const result = await analyzeProtocol(protocol)
  expect(result.recommendations[0].evidence?.citations).toContainEqual(expect.objectContaining({ source_id: 'doi:p4:u2', citation: expect.stringContaining('p. 4') }))
  expect(result.recommendations[0].evidence?.why_replacement).toContainEqual(expect.objectContaining({ content: expect.stringContaining('Candidate evidence') }))
})
it('passes status-labelled page evidence—not article snippets—to Phase 2.7 re-evaluation', () => {
  expect(buildReevaluatePrompt(recommendation, [candidateMatch('doi:p7:u1')])).toContain('candidate_pending_adjudication')
  expect(buildReevaluatePrompt(recommendation, [candidateMatch('doi:p7:u1')])).toContain('Pages: 7–7')
})
```

Assert neither Phase 2.5 nor Phase 2.7 imports/calls `searchLiterature`, and re-evaluation cannot see `authors`, `journal`, or `content_snippet` fields from the obsolete type.

- [ ] **Step 2: Run targeted tests and confirm failure**

Run: `npm test -- tests/lib/pipeline-ranking.test.ts tests/lib/reevaluation.test.ts`

Expected: FAIL because Phase 2.7 still calls article-level retrieval and prompt formats article snippets.

- [ ] **Step 3: Replace both article-level paths**

Use `searchLiteratureEvidence({ query, limit: 3, threshold: 0.25 })` in Phase 2.5 and `{ query, limit: 5, threshold: 0.25 }` in Phase 2.7. Deduplicate Phase 2.5 by evidence ID; prefix evidence content exactly `Candidate evidence — ` when status is `candidate_pending_adjudication`. Remove old chemical/principle filters because evidence RPC has no such columns. Keep `Promise.allSettled` Phase 2.5 isolation and current Phase 2.7 per-recommendation error handling.

Keep the existing pipeline evaluator provider unchanged: it is not the scoped chat agent. Do not add any provider fallback. The prompt must say candidate evidence is preliminary and must not make a candidate alone sufficient to confirm/suppress an intervention.

- [ ] **Step 4: Run pipeline tests**

Run: `npm test -- tests/lib/pipeline-ranking.test.ts tests/lib/reevaluation.test.ts`

Expected: PASS; no test mock or production reference to `literature_precedents` remains in these paths.

- [ ] **Step 5: Commit migration**

```bash
git add lib/pipeline.ts lib/prompts/reevaluate.ts tests/lib/pipeline-ranking.test.ts tests/lib/reevaluation.test.ts
git commit -m "feat: ground all recommendation retrieval in evidence units"
```

## Task 4: Add a bounded, citation-carrying chat literature tool and true streaming

**Files:**
- Modify: `lib/talk-about-this/tools.ts`, `agent.ts`, `prompt.ts`
- Modify: `app/api/talk-about-this/[conversationId]/messages/route.ts`
- Modify: `tests/lib/talk-about-this/tools.test.ts`, `agent.test.ts`, `prompt.test.ts`

**Interfaces:**

```ts
export type ToolName = /* existing */ | 'search_scoped_literature_evidence'
export interface LiteratureEvidenceToolCall { id: string; name: 'search_scoped_literature_evidence'; query: string; signalGroups?: EvidenceSignalGroup[] }
export interface ChatRunResult { answer: string; citations: Citation[]; evidence: LiteratureEvidenceMatch[] }
```

`runScopedToolChat()` returns `ChatRunResult`; tool-complete events contain only a bounded structured `evidence` array of five display-safe rows and corresponding citations.

- [ ] **Step 1: Write failing boundary and data-flow tests**

```ts
expect(parseScopedToolCall(context, { id: 'lit-1', name: 'search_scoped_literature_evidence', arguments: JSON.stringify({ query: 'DMF replacement comparison', signalGroups: ['comparison'] }) }, new Map()))
  .toEqual({ id: 'lit-1', name: 'search_scoped_literature_evidence', query: 'DMF replacement comparison', signalGroups: ['comparison'] })
expect(() => parseScopedToolCall(context, { id: 'lit-2', name: 'search_scoped_literature_evidence', arguments: JSON.stringify({ query: 'x'.repeat(501) }) }, new Map())).toThrow('500')

it('propagates a retrieved evidence citation from agent to terminal result', async () => {
  const result = await runScopedToolChat(/* provider requests literature then returns text */)
  expect(result.citations).toContainEqual(expect.objectContaining({ source_id: 'doi:p3:u1' }))
  expect(result.evidence).toContainEqual(expect.objectContaining({ candidateStatus: 'candidate_pending_adjudication', pageStart: 3 }))
})
```

Cover unknown property/signal, query without a context term, abort/timeout returning `tool-failed`, and agent→route test proving an evidence-unit ID absent from snapshot citations is persisted on the assistant message and is emitted with structured page/status metadata.

- [ ] **Step 2: Run focused chat tests and confirm failure**

Run: `npm test -- tests/lib/talk-about-this/tools.test.ts tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/prompt.test.ts`

Expected: FAIL because the tool and `ChatRunResult` contract do not exist.

- [ ] **Step 3: Implement tool, propagation, and true first-delta semantics**

Schema permits only `query` and `signalGroups`, with `additionalProperties: false`. It validates query/group bounds and requires a case-insensitive scoped chemical or exact original/alternative recommendation phrase. `executeScopedTool` invokes `searchLiteratureEvidence({... signal})` before chemistry-service fetch and returns five max results plus `citationFromEvidenceMatch()` values.

In the agent, send each provider `event.text` to `onEvent('delta', { text })` at receipt, accumulate it for persistence, and mark the first forwarded text timestamp in the route. If a provider also sends tool calls, retain the visible preliminary text and continue with tool activity; do not fabricate a text delta. Aggregate only literature tool citations/evidence in `ChatRunResult` by evidence-unit ID. Preserve four rounds, three calls/turn, and 5-second per-call/12-second total timeouts; propagate the combined abort signal through retrieval. The prompt says candidate status must be named verbatim and the model must not claim a saved action occurred except on a server-generated receipt.

Route changes: whitelist `evidence` and `citations` in `tool-complete`; collect `ChatRunResult.citations`, merge unique IDs with snapshot citation IDs, save them with the assistant message, and send `done` with `citationIds` and structured evidence records. Never derive new citations from free text.

- [ ] **Step 4: Run chat tests**

Run: `npm test -- tests/lib/talk-about-this/tools.test.ts tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/prompt.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit chat retrieval**

```bash
git add lib/talk-about-this/tools.ts lib/talk-about-this/agent.ts lib/talk-about-this/prompt.ts app/api/talk-about-this/[conversationId]/messages/route.ts tests/lib/talk-about-this
git commit -m "feat: stream scoped literature evidence in chat"
```

## Task 5: Secure immutable conversations, revision-aware updates, and atomic approval

**Files:**
- Create: `supabase/migrations/20260812000000_secure_talk_actions.sql`
- Create: `lib/talk-about-this/actions.ts`
- Modify: `lib/talk-about-this/context.ts`, `repository.ts`
- Modify: `app/api/talk-about-this/route.ts`, `app/api/talk-about-this/[conversationId]/messages/route.ts`
- Modify: `app/api/analyses/[id]/route.ts`, `app/analyze/[id]/page.tsx`
- Create: `tests/lib/talk-about-this/actions.test.ts`

**Interfaces:**

```ts
export function isExplicitScopedApprovalRequest(content: string): boolean
export async function approveScopedRecommendation(input: { supabase: SupabaseClient; conversationId: string }): Promise<{
  actionId: string; recommendationId: string; label: string; alreadyAccepted: boolean; revisionNumber: number
}>
```

The action helper calls only `supabase.rpc('approve_scoped_recommendation', { p_conversation_id: conversationId })`; caller/user/recommendation/analysis IDs are not arguments.

- [ ] **Step 1: Write failing security and approval tests**

```ts
it.each(['approve this', 'Accept this recommendation.'])('recognizes direct approval %j', text => expect(isExplicitScopedApprovalRequest(text)).toBe(true))
it.each(['should I approve this?', 'do not approve this', 'approve this if it is safe', 'approve this and reject the next'])('rejects non-authorizing text %j', text => expect(isExplicitScopedApprovalRequest(text)).toBe(false))
it('calls one RPC with conversation ID only', async () => {
  await approveScopedRecommendation({ supabase, conversationId: 'conversation-1' })
  expect(rpc).toHaveBeenCalledWith('approve_scoped_recommendation', { p_conversation_id: 'conversation-1' })
})
```

Test migration/RPC integration for: direct client `INSERT` into `gpc_talk_actions` denied; owner cannot update `scope`, `context_snapshot`, `context_hash`, or `analysis_id`; principle/index scope approval fails; current analysis lacks target fails; duplicate calls return same/valid idempotent receipt; two simultaneous conversation approvals preserve both target flags; stale client PATCH conflicts rather than overwriting an approval.

- [ ] **Step 2: Run action tests and confirm failure**

Run: `npm test -- tests/lib/talk-about-this/actions.test.ts`

Expected: FAIL because the helper/RPC/migration does not exist.

- [ ] **Step 3: Add immutable schema and atomic RPC**

Migration must:

1. Drop `Users can update own talk conversations`; do not replace it with a broad update policy. Existing conversations are immutable, and no current feature requires status mutation.
2. Create `gpc_talk_actions` with foreign keys, `action_type = 'approve_recommendation'`, `status = 'completed' | 'failed'`, target recommendation ID, `already_applied`, revision, timestamps, and `UNIQUE (conversation_id, action_type)`. Enable RLS with **SELECT only** for `auth.uid() = user_id`; no client INSERT/UPDATE/DELETE policy.
3. Define `approve_scoped_recommendation(p_conversation_id uuid)` as `SECURITY DEFINER SET search_path = public`. It verifies `auth.uid()` is nonnull, locks the owned conversation (`FOR UPDATE`), requires `scope.kind = recommendation` plus nonblank `scope.recommendationId`, and verifies the stored `context_snapshot.scope` agrees with its immutable scope. It locks the owned analysis (`FOR UPDATE`), finds exactly one recommendation with this stable ID, updates only that JSONB array element’s `isAccepted` via `jsonb_set`, increments `revision_number`, inserts the completed receipt, and returns action ID/target/label/already-applied/revision. `ON CONFLICT (conversation_id, action_type)` returns the existing receipt without another state change. A caught target/authorization failure inserts no forged completed receipt and raises an error.
4. Revoke direct public table modification privileges if present; grant authenticated users only `EXECUTE` on the function and the RLS-protected `SELECT` of their receipts.

- [ ] **Step 4: Implement stable-ID and revision-aware application logic**

At conversation creation, a recommendation scope with `recommendationIndex` remains permitted but is marked read-only. A recommendation scope with `recommendationId` must resolve to exactly one recommendation. The UI shows approval guidance only when scope carries that stable ID.

Expose `revisionNumber` from analysis GET. Require PATCH input:

```ts
{ analysis_result: AnalysisResult; expected_revision_number: number }
```

Update only when `.eq('revision_number', expected_revision_number)`, atomically increment it, and return `409` on a mismatch. The analysis page keeps the returned revision after successful normal PATCH and displays a reload-required conflict rather than retrying stale full-document writes. The approval callback receives RPC revision and updates UI state/revision **without PATCHing again**.

Before Qwen starts, messages route recognizes the exact approval phrase. It calls the RPC, persists user and receipt assistant message, then emits:

```ts
send('recommendation-approved', { recommendationId: receipt.recommendationId, label: receipt.label, alreadyAccepted: receipt.alreadyAccepted, actionId: receipt.actionId, revisionNumber: receipt.revisionNumber })
send('done', { status: 'complete', ttftMs: null, citationIds: [], action: 'approve_recommendation' })
```

It does not ask Qwen to authorize or choose the mutation target. All other messages use the read-only agent path.

- [ ] **Step 5: Apply migration and run action tests**

Run: `supabase db push --linked && npm test -- tests/lib/talk-about-this/actions.test.ts && supabase migration list --linked`

Expected: PASS; remote migration present; direct table insert denied; RPC handles duplicate/concurrent approvals atomically.

- [ ] **Step 6: Commit authorization boundary**

```bash
git add supabase/migrations/20260812000000_secure_talk_actions.sql lib/talk-about-this/actions.ts lib/talk-about-this/context.ts lib/talk-about-this/repository.ts app/api/talk-about-this app/api/analyses/[id]/route.ts app/analyze/[id]/page.tsx tests/lib/talk-about-this/actions.test.ts
git commit -m "feat: atomically approve immutable scoped recommendations"
```

## Task 6: Render structured evidence and server action receipts

**Files:**
- Modify: `components/TalkAboutThis.tsx`, `components/AnalysisResults.tsx`, `components/FinalizedProtocol.tsx`
- Modify: `tests/lib/talk-about-this/activity.test.ts`

**Interfaces:**

```ts
onRecommendationApproved?: (input: { recommendationId: string; revisionNumber: number }) => void
export function approvalFromEvent(data: Record<string, unknown>, scope: TalkAboutScope): { recommendationId: string; label: string; revisionNumber: number } | null
```

- [ ] **Step 1: Write failing activity/UI tests**

```ts
expect(activityForEvent('tool-complete', { callId: 'lit-1', tool: 'search_scoped_literature_evidence', status: 'ok', source: 'GC.ai literature evidence units' }))
  .toMatchObject({ label: 'Received scoped literature evidence', state: 'complete' })
expect(approvalFromEvent({ recommendationId: 'rec-1', label: 'Step 1: DMF → EtOAc', revisionNumber: 3 }, { kind: 'recommendation', recommendationId: 'rec-1' }))
  .toEqual({ recommendationId: 'rec-1', label: 'Step 1: DMF → EtOAc', revisionNumber: 3 })
expect(approvalFromEvent({ recommendationId: 'rec-2', revisionNumber: 3 }, { kind: 'recommendation', recommendationId: 'rec-1' })).toBeNull()
```

Test a tool-complete payload renders source ID, title, pages, quote, and literal candidate status; malformed/mismatched payload is ignored; a stable recommendation scope displays approval guidance; principle/index scope does not.

- [ ] **Step 2: Run focused activity test and confirm failure**

Run: `npm test -- tests/lib/talk-about-this/activity.test.ts`

Expected: FAIL because evidence/approval event handling does not exist.

- [ ] **Step 3: Implement exact UI reconciliation**

Whitelist `evidence` on SSE parse; render returned records as source IDs with page range, quote, status, applicability, and limitations. Render `Candidate evidence` from structured status, never from model markdown. On `recommendation-approved`, validate stable scope/ID/revision, append server receipt, call parent callback, and ignore malformed/mismatched events. Parent state update marks only the ID-matched recommendation accepted and stores returned revision; it does not invoke its existing debounced PATCH.

Replace the header’s inaccurate read-only claim only for stable recommendation scope: “You may explicitly approve this scoped recommendation by sending ‘approve this’; other analysis changes are unavailable.” Retain read-only wording for all other scopes.

- [ ] **Step 4: Run UI tests**

Run: `npm test -- tests/lib/talk-about-this/activity.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit UI integration**

```bash
git add components/TalkAboutThis.tsx components/AnalysisResults.tsx components/FinalizedProtocol.tsx tests/lib/talk-about-this/activity.test.ts
git commit -m "feat: render evidence and scoped approval receipts"
```

## Task 7: Verify evidence, approval, and latency end to end

**Files:**
- Modify: `BACKLOG.md`
- Modify: `docs/superpowers/specs/2026-08-12-evidence-backed-chat-actions-design.md` only with observed verification values.

- [ ] **Step 1: Run focused contracts**

Run:

```bash
python3 -m pytest scripts/literature/test_import_evidence_units_supabase.py -q
npm test -- tests/lib/literature-evidence.test.ts tests/lib/pipeline-ranking.test.ts tests/lib/reevaluation.test.ts tests/lib/talk-about-this/tools.test.ts tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/prompt.test.ts tests/lib/talk-about-this/actions.test.ts tests/lib/talk-about-this/activity.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run authenticated browser scenario**

1. Start chemistry service/app with configured `CHAT_LLM_BASE_URL`, `CHAT_LLM_MODEL`, and Supabase values.
2. Open a saved analysis with a stable recommendation ID and known retrievable evidence.
3. Open its chat, ask for the evidence comparison, and observe activity before retrieval/final text.
4. Verify rendered result has evidence-unit ID, title, pages, quote, and `Candidate evidence` where applicable.
5. Send `approve this`; verify the server receipt and only that card’s accepted state.
6. Reload; verify accepted state and the receipt remain. Inspect action row fields and match conversation/target/revision.
7. Send `approve this` in a principle chat; verify server returns no mutation.
8. In two browser contexts, approve two different recommendations concurrently; reload and verify both remain accepted. Submit a stale normal PATCH; verify `409`, not a lost acceptance.

- [ ] **Step 3: Enforce real TTFT release gate**

Instrument timestamps for provider first text, embedding start/end, RPC start/end, and final provider first text. Store true first forwarded delta as `ttft_ms`; do not count activity. Exercise a warm retrieval chat at least three times and record each first-delta time. The release is blocked if any representative warm run exceeds 3,000 ms until the responsible stage is reduced; do not mask it with synthetic deltas or a changed metric.

- [ ] **Step 4: Run project verification**

Run: `npm test && npm run build`

Expected: PASS.

- [ ] **Step 5: Record evidence and complete release bookkeeping**

Only after remote import counts match manifest, both retrieval paths return page-bounded candidate-labelled material, atomic approval/concurrency browser checks pass, and all warm TTFT values are ≤3,000 ms: record counts/timings in the approved spec, mark the exact backlog item complete, and commit.

```bash
git add BACKLOG.md docs/superpowers/specs/2026-08-12-evidence-backed-chat-actions-design.md
git commit -m "docs: verify evidence-backed chat release"
```

## Release checklist

- [ ] CRGSC v5 embedding file is 1536-dimensional; complete manifest checksums/counts match remote source/evidence rows.
- [ ] Neither Phase 2.5 nor Phase 2.7/reevaluation uses `literature_precedents`.
- [ ] Every source is page-bounded; candidate/adjudication status remains visible in recommendations and chat.
- [ ] Chat uses the configured Qwen/open-weights endpoint with no proprietary fallback.
- [ ] Conversation target/context cannot be mutated after creation; receipts cannot be directly inserted by clients.
- [ ] Direct approval uses a stable ID and one transactional RPC; duplicate/concurrent actions preserve all accepted flags and receipts.
- [ ] Dynamic chat evidence citations are saved and rendered as structured evidence, not inferred from model text.
- [ ] Verified true first model delta is ≤3,000 ms in three representative warm retrieval chats.
- [ ] Focused tests, full suite, build, migration verification, and authenticated browser scenario pass.
