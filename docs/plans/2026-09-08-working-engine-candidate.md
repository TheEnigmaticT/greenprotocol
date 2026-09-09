# Working Engine Candidate Implementation Plan

> **Historical implementation plan:** The working candidate was checkpointed as `4ba0a345e6e4d08b9e36728091bb3b8ee39dbf8b`. The user subsequently authorized local checkpoint/cleanup commits, not merges, pushes, or deployments. Current commands and verification boundaries are in [the working-engine runbook](../runbooks/working-engine-candidate.md).

**Goal:** Deliver one runnable engine candidate that takes each established validation procedure through the real analysis pipeline to a complete inspectable result, accepting lower scientific quality than cloud SOTA while preserving chemical identities, explicit uncertainty, and intended provider routing.

**Architecture:** Start from production-baseline commit `6e90ec991005004ce908b06e7e51e37c8fe0de46` plus the existing minimal Qwen-parity compatibility repairs. Keep parsing, chemical reference lookup/SMILES, deterministic scoring, principle recommendations, literature lookup/re-evaluation and assembly. Use OpenRouter-hosted `qwen/qwen3.8-27b` as the user-approved proxy for an eventual locally hosted model. Centralize an explicit OpenAI-compatible endpoint/model setting across TypeScript and Python; no hidden Anthropic fallback. Local inference itself is NOT a delivery gate. LlaSMol is optional and excluded from the first candidate.

**Tech Stack:** Existing Next.js/TypeScript engine, OpenAI-compatible transport, FastAPI/Python chemistry service, RDKit, existing cache/reference store, Vitest/Pytest.

## Scope and success contract
- Candidate root: `/Users/ct-mac-mini/dev/greenchemistry-ai-engine-candidate`, branch `feat/portable-engine-candidate`.
- Preserve the parity and broader scientific-audit trees untouched. Do not import the entire strict scoring audit or redesign scoring formulas/weights/denominators.
- Runtime completeness, useful output and scientific correctness are separate. Lower-quality recommendations are acceptable; invented input identities/quantities represented as facts are not.
- Five distinct existing procedures: aspirin demo, Suzuki example, benchmark fixture-1 esterification, fixture-2 polymer precipitation, fixture-3 condensation. Each gets a distinct persisted local result and source fingerprint from the actual `analyzeProtocol` function plus a live authenticated local chemistry service.
- A successful run has parsed steps/materials, an explicit chemistry/scoring state, all principle generation outcomes accounted for, and an assembled result or explicitly unchanged original if no usable changes exist. No fabricated scores/results; unknown/indefinite inputs should limit dependent calculations rather than abort the whole analysis.
- Research calls remain part of the pipeline. Record actual returned matches, unavailable/configuration failures and no-results distinctly where existing contracts permit. Corpus expansion is not part of this task.
- Verify no unexpected provider calls in the run captures. OpenRouter chat/embedding requests are explicitly documented; local chemistry API and explicitly configured reference/research endpoints are the other allowed destinations. Never expose credentials or use production writes for probes.
- Authenticated browser persistence/acceptance/release deployment is not the acceptance scope of A/B; do not claim those journeys verified by direct-engine runs.

## Task 1 — Consolidate and establish baseline
**Files:** existing parity diff copied to this clean baseline; `package.json`, lockfile, this plan. The historical parity probe used as a runner reference is preserved at checkpoint `4ba0a34:scripts/run-qwen-parity.ts`; the supported entry point is now `scripts/run-engine-candidate.ts`.
1. Preserve existing source trees; import only the known compatibility changes into the candidate (completed during setup).
2. Install candidate-local dependencies with `npm ci`; do not symlink node_modules across worktrees.
3. Run current web/Python tests and type/lint/build checks. Save failures, identify introduced versus baseline defects, fix only what blocks this candidate's operation/verification.
4. Record a live first-case baseline before broad scientific tuning. No specialist-model investigation.

## Task 2 — Explicit model transport and bounded completion
**Files:** `lib/qwen-adapter.ts`, provider seam in `lib/pipeline.ts`, `lib/literature-evidence.ts`, `services/chemistry/llm_client.py`; focused transport tests. New small runtime-config helper only if needed.
1. Write failing tests proving the selected compatible endpoint/model is used even when Anthropic/OpenAI credentials are present, and failures never trigger another provider.
2. Reuse native forced tool output and validate required response shape. Preserve original pipeline contracts.
3. Add bounded same-provider retry/backoff for actual throttling/provider errors and conservative principle concurrency. No infinite retries or model cascade. Partial stages must not silently become successful generation.
4. Make the hosted-Qwen endpoint/model explicit and configurable for later compatible local serving. Embedding routing must be explicit too; do not substitute embedding families against an incompatible existing index.
5. Run focused tests including malformed/truncated output, retry exhaustion, missing configuration, and observed provider-error envelopes.

## Task 3 — Consistent chemical identity/reference lookup
**Files:** `services/chemistry/converter.py`, `main.py`, `synonyms.py`, relevant scoring reference consumers; existing converter tests plus new shared-identity regressions.
1. Centralize/reuse the existing exact cached alias resolution rather than invent fuzzy chemistry names.
2. Use the same resolved identity for structures, hazard lookups, solvent/reference classification and original request mapping. Preserve internal parentheses in catalyst names.
3. Test the exact combined DMF and Pd(PPh3)4 aliases and unknown/indefinite materials through conversion AND scoring inputs.
4. Preserve missing-reference/hazard status; do not treat absence as proof of safety or synthesize representative molecules for polymers/mixtures.
5. Retain current recovery behavior; do not build a generalized ingestion platform.

## Task 4 — Occurrence-local quantities, roles and reaction authority
**Files:** `lib/pipeline.ts`, `lib/prompts/parse.ts`, `lib/types.ts`, `lib/chemistry-service.ts`, `services/chemistry/scoring/models.py`, `main.py`, `smiles_extractor.py`; focused TypeScript/Python regression tests.
1. Trace exact input and response schemas before changes. Add tests for reordered/short/mismatched enrichment batches and repeated chemical names with different step quantities.
2. Match reference conversion to the correct material occurrence, never global first-name quantities. Clear unsupported model mass guesses; prefer deterministic conversion of declared quantities and preserve null when absent.
3. Include explicitly declared products in parse roles. Separate reagent/catalyst/solvent/workup roles without reaction-specific hacks; retain the raw quantity and occurrence context into scoring.
4. Supply retrieved structures to the reaction helper. Reject generated reactions that silently replace known reactants; distinguish inferred reaction data from source identity. An unavailable reaction must not block unrelated scores/recommendations.
5. Avoid forcing physical polymer processing into a small-molecule reaction. Keep uncertainty explicit, do not require perfect forward prediction.
6. Do not import wholesale stricter scoring policy. Only minimal dependent-input rejection necessary to avoid scoring a demonstrably different reaction is in scope.

## Task 5 — Real engine run and finish the candidate
**Files:** add one bounded candidate runner under `scripts/`, reuse established public fixtures and existing real pipeline/service; local results outside tracked source; runbook under `docs/runbooks/`.
1. Create an explicit, repeatable command with loopback authenticated chemistry service, isolated writable cache, approved OpenRouter configuration and no production-write capability. Use normal existing credential environment; never read/display credential files.
2. Run one real pilot, inspect the failure boundary if blocked, repair that blocker and rerun with original failure preserved.
3. Run all five procedures serially through `analyzeProtocol`; preserve raw failures locally, sanitized result summaries, source hashes, real request receipts and stage outcomes. Do not replace failures with mock outputs.
4. Add/execute focused negative tests: provider unavailable; malformed parse; incomplete chemistry; repeated quantities; false reaction identity; physical process. Use doubles for controlled failure tests and label them separately from live evidence.
5. Independent spec review then quality review of changed scope; fix material findings only. Run full relevant tests/types/lint/build and report exact remaining limitations.
6. Deliver runnable command, candidate location, fixture outcome table and remaining scientific limitations. End-to-end completion is the milestone; another plan, helper test count or successful standalone model call is not completion.

## Explicit non-goals
- No aspirin-specific optimization, model bakeoff, LlaSMol integration requirement, fully local performance qualification, scoring-method redesign, broad literature hydration, UI redesign, ELN integration, production migrations/deployment or repository-wide cleanup.
- Portability requires explicit dependencies and configurable compatible model routing. OpenRouter is the approved development proxy; offline/all-local operation is a later runtime verification, not an excuse to delay this candidate.

## Execution ownership and recovery
Parent owns shared pipeline integration, runner/service launch and final result. Workers own disjoint files, verify the absolute worktree/branch before edits, and never launch paid probes or services. Runtime failures get a concrete narrow fix, not a new architecture project. Original dirty trees and failed artifacts remain intact. A later provider/access decision is escalated only if genuinely outside this authorization.
