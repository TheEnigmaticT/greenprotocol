# Scientific pipeline realignment

## Decision contract

The intended sequence is procedure → validated chemical/reaction representation → hydrated facts and explicit missing-data records → applicable reaction/literature evidence → principle decisions → supported recommendations → before/after impact assessment.

Chemical identity/properties establish what a material is and known hazards; they do not establish that a proposed replacement performs the same transformation. No supported substitution is a valid result. A hypothesis card is not permission to apply a change to a revised protocol. Missing impact factors must not become zero-impact alternatives.

## First bounded change

Connect the existing chemistry-service enrichment to the principle decision prompts. Preserve sources, returned reference status and queued/unavailable information. Treat static chemical records as labeled fallback screening information, not live hydration or reaction-specific validation. An empty hazard list means no hazard evidence returned, not verified safety.

Acceptance:

- A parsed chemical absent from the static database carries its returned structure, properties, hazard sources and citations into the actual principle model request.
- Service failure or missing reference data is explicit in the decision input; no fabricated values or blanket safety claims fill gaps.
- Existing local-provider fail-closed behavior, ownership and persistence boundaries remain intact.
- Tests exercise the pipeline connection, not only a helper's string formatting.

## Boundaries not completed by this change

- Shared PubChem request budgeting at one request per second across foreground and recovery workers; field-level hydration completeness and retry semantics.
- Canonical reaction representation and reaction-/product-relevant retrieval before candidate generation. Locate and validate the existing reaction resources before designing a replacement store.
- Literature applicable to the original transformation before principle decisions; current post-generation retrieval is not a substitute.
- Evidence-based assembly eligibility for revised protocols.
- Before/after process inventories and honest screening/LCA availability.

Historical code, current source wiring, local dataset presence and deployed data availability are separate claims. Do not call a gap a local-model regression without evidence from earlier executable code.

## Verification

Use existing CI gates, not a new runner:

```sh
npm run test
npm run lint
npx tsc --noEmit
npm run build
```

For hosted Qwen evidence inspection, reuse `scripts/smoke-full-analyze-local.ts` with explicit local pipeline/provider/model configuration and unique output paths. Capture raw requests/responses without headers or credentials. Check whether chemical evidence reached principle requests; a returned result alone is not an accuracy pass. Use aspirin plus a contrasting protocol, not a minimum swap count.

A direct pipeline smoke does not exercise authenticated SSE, owner-scoped database persistence, the browser or the recovery worker. Report those separately. Existing Path B classification regressions and prior live failures are documented in [path-b-accuracy.md](path-b-accuracy.md).

## First-slice results

- Historical check: `1b0bcc8:lib/prompts/principles.ts` already used `findChemical` and model knowledge fallback. `1682eb7:lib/pipeline.ts` added batch enrichment but still passed only parsed steps into principle evaluation. This disconnection predates local-model migration; an earlier reaction-database-backed recommendation engine was not established by the inspected repository history. External reaction corpus location/availability remains unresolved.
- Implemented: `lib/pipeline.ts` passes enrichment into every principle request through `buildPrincipleUserMessage`; `lib/prompts/principles.ts` formats properties, hazard sources, citation handles and unavailable states. Chemistry client/result types retain reference status and queue metadata. Existing static records are labeled fallback screening estimates, and hazardous inventory alone no longer demands a substitution in the principle prompt.
- Regression evidence: new tests failed before the connection was implemented. Full serial suite passed **936 tests across 72 files**. Default parallel execution passed during implementation but a final repeat failed the existing replacement-symlink discovery-confinement test (935 passed, 1 failed). Failure log: `/tmp/gcai-realignment-verified-tests.log`; serial log: `/tmp/gcai-realignment-verified-serial-tests.log`. No confinement checks were removed or weakened.
- Lint, TypeScript, production build and diff whitespace checks passed. Existing lint warnings remain.
- Hosted `qwen/qwen3.8-27b` aspirin and Suzuki runs both returned results. Raw capture confirms **12 principle requests per run**, each containing hydrated provenance, molecular-property context and citation source handles. The Suzuki run represented brine as indefinite and completed partial scoring.
- These are evidence-delivery passes, **not chemistry-accuracy passes**. Aspirin still proposed acetic anhydride → acetic acid; both swaps were downgraded, but assembly still treated a substitution as the principal improvement. Suzuki also downgraded all five reevaluated swaps. Reaction-specific evidence and assembly eligibility remain blocking scientific gaps.
- Raw model requests/responses, result summaries and a hashed principle-request manifest are retained under `/tmp/gcai-realignment-live/`; `verification.json` records the per-run evidence-delivery checks. Capture excludes authentication headers. These temporary artifacts are not a permanent data store.
- No authenticated UI/SSE, database readback or worker run was exercised. No commit, push, merge or deploy. Existing user model-routing edits were preserved. A proposed short `CLAUDE.md` link/test-command update was not applied because protected-file approval timed out; the file remains unchanged.

## Overnight safety boundary follow-up (2026-09-08)

- Implemented an explicit per-recommendation application gate. A `chemical_swap` is `supported` for procedure assembly only when Phase 2.7 has (a) a `confirm` action, (b) `supportsAlternative: true`, (c) `contextMatch: strong|partial`, and (d) at least one retrieved evidence record not labelled `candidate_pending_adjudication`. Candidate-only, no-match, downgraded, unsupported, and failed re-evaluations are retained as `hypothesis_only` or `unavailable`; they cannot alter the assembled or finalized procedure.
- The finalized-protocol consumer has the same gate. It refuses to reuse an old preassembled draft if any accepted recommendation was not eligible, closing the persisted-draft bypass as well as the new assembly path.
- Impact deltas are now explicitly `unavailable`, rather than calculating equal-mass savings from static per-kg factors or default material quantities. The endpoint persists zero metrics with an `assessment` reason; the Impact Scoreboard renders the unavailable state. This is not a full LCA or a new screening method. A future screening estimate needs an inspected, source-backed before/after inventory contract and substitution-specific factors.
- Targeted corpus discovery: searched this worktree for `ORD`, `Open Reaction Database`, `USPTO`, `reaction corpus`, and reaction-SMILES references, then searched small project manifests/readmes/docs under `/Users/ct-mac-mini/dev`. No reaction corpus or active ORD/USPTO retrieval implementation was located. The only active reaction representation found is a model-extracted, RDKit-validated `reaction_smiles` passed to chemistry-service scoring for P2; it is not persisted/shared with principle evidence retrieval. Do not call it corpus evidence or ORD integration.
- Hydration audit: foreground conversion checks process cache and durable `ReferenceStore` cache before live PubChem, and retryable misses are durably queued. `fetch_pubchem_json` has retry/backoff but no shared global request coordinator; concurrent foreground batches and recovery workers can therefore exceed a one-request-per-second budget. A process-local limiter would not satisfy the cross-worker/replica requirement, so no misleading limiter was added. A durable shared lease/rate-budget design needs an owner/schema decision before implementation.

## Continuation implementation (2026-09-08)

- Principle generation now receives bounded `predecisionEvidence` before any principle request. It reuses the score service's returned `reaction_smiles`, carries parsed materials/conditions and up to three evidence-unit source handles, quotes and limitations, and is persisted in `AnalysisResult`. Dense retrieval remains explicit candidate context: semantic similarity alone does not establish an applicable reaction precedent or permit a substitution.
- Added, but did not deploy, `20260908000000_add_pubchem_request_budget.sql`. It provides a server-time, row-locked shared slot RPC. Python acquisition happens immediately before each PubChem HTTP attempt and fails closed as retryable `rate_budget`; cache hits consume no slot.
- Serial web verification passed: 942 tests across 73 files; focused TypeScript request-payload regressions and `tsc --noEmit` passed. Targeted Python budget/recovery/reaction tests passed (5). The full Python suite has two assistant-tool fixture failures because its bare local configuration lacks the new budget RPC; no tests were weakened. Playwright auth smoke timed out locally, so authenticated persistence and deployed-worker assertions remain unverified.
- Full continuation evidence and exact blockers: `scientific-pipeline-continuation-2026-09-08.md`.
