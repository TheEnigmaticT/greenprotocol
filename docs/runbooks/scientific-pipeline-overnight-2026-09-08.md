# Scientific pipeline overnight report — 2026-09-08

## Scope and guardrails observed

Work remained in `/Users/ct-mac-mini/dev/greenchemistry-ai-local-e2e` on `feat/local-model-pipeline` at the required starting HEAD `7af3d219f5dba2df30df21eae6b55058104773ee`. Pre-existing dirty work, including local model identifiers, was preserved. No commit, push, merge, deployment, remote migration, production-data change, credential inspection, or protected-instruction-file change was made.

## Completed

### 1. Evidence-to-assembly safety gate

Files: `lib/types.ts`, `lib/pipeline.ts`, `lib/recommendation-kind.ts`, `lib/finalized-protocol.ts`.

- Added explicit `applicationEligibility` to recommendations: `supported`, `hypothesis_only`, or `unavailable`.
- Procedure assembly now accepts only evidence-supported chemical swaps. The gate requires a Phase 2.7 confirmation, `supportsAlternative: true`, `contextMatch: strong|partial`, and a retrieved non-candidate literature record.
- Candidate-only, missing, unsupported, downgraded, and re-evaluation-failed swaps remain visible as hypotheses or unavailable records. They cannot be silently applied.
- Finalized-protocol construction uses the same gate and refuses to reuse an already-assembled draft if an accepted recommendation was ineligible. This closes the historical/persisted-draft bypass.

Regression coverage:

- `tests/lib/recommendation-kind.test.ts` proves an unsupported acetic-anhydride-to-acetic-acid hypothesis stays available for review but is excluded from assembly.
- It also proves a preassembled draft containing an accepted unsupported hypothesis is not returned by finalization.
- `tests/lib/pipeline-ranking.test.ts` exercises the actual pipeline consumer: candidate-only evidence plus a non-supporting reevaluation becomes `hypothesis_only`, and the output revised protocol remains the original procedure.

### 2. Honest impact status

Files: `app/api/analyze/route.ts`, `components/ImpactScoreboard.tsx`, `lib/types.ts`.

- Removed fabricated equal-mass/default-quantity static-factor savings from endpoint and accepted-recommendation impact paths.
- Persisted impact results now report zero metrics with `assessment.level: "unavailable"` and an explicit reason. The UI displays that unavailable state instead of a false before/after comparison.
- `screening_estimate` and `full_lca` are explicit assessment levels in the type, but neither is claimed or produced by this change.
- A real screening/LCA implementation still needs approved, source-backed before/after process inventories and substitution-specific impact factors.

Regression coverage:

- `tests/lib/analyze-route.test.ts` confirms an evidence-supported synthetic substitution with a known original quantity persists `assessment.level: "unavailable"`, not made-up same-mass savings.

### 3. Bounded live verification

Artifact directory: `/tmp/gcai-overnight-20260908/live-aspirin/`.

Ran the existing direct-pipeline smoke with explicit hosted configuration:

- `GCAI_LOCAL_PIPELINE=1`
- `GCAI_LOCAL_PROVIDER=openrouter`
- `GCAI_LOCAL_MODEL=qwen/qwen3.8-27b`
- raw request/response capture via `/tmp/gcai-path-b-capture.mjs`

Result:

- Built-in aspirin smoke returned after 357 seconds, with deterministic scoring available and five recommendations.
- It again proposed acetic anhydride → glacial acetic acid and phosphoric acid → Amberlyst-15. Both re-evaluations were downgraded (`confirmed: 0`, `downgraded: 2`).
- The revised protocol length was exactly 370 bytes, equal to the original protocol source length; its assessment says `No chemical substitutions to apply; process/analytical tips remain available for review.` This verifies the original harmful unsupported-assembly scenario was blocked in this direct-pipeline run.
- This is a pipeline safety-boundary pass, not a chemistry-accuracy pass. One principle request timed out, and direct smoke does not exercise authenticated SSE, database persistence, or workers.

### 4. Discovery and hydration findings

- Targeted repository and `/Users/ct-mac-mini/dev` manifest/readme/doc searches found no ORD, USPTO, or other reaction corpus and no active corpus retrieval integration. The active reaction representation is model-extracted, RDKit-validated reaction SMILES used only by chemistry scoring P2; it is not shared as evidence context. A corpus owner/location decision is required before implementing reaction-precedent retrieval.
- `converter.py` is cache-first and uses durable `ReferenceStore` cache/queue behavior correctly for retryable misses. `pubchem.fetch_pubchem_json` has retries/backoff but no cross-worker or cross-replica shared rate budget. No process-local limiter was added because it would not meet the requested global one-request-per-second policy. A durable shared lease/rate-budget design requires a schema/owner decision.

## Verification

Focused tests after the final gate change:

- `npx vitest run tests/lib/recommendation-kind.test.ts tests/lib/pipeline-ranking.test.ts tests/lib/analyze-route.test.ts`
- Result: 42 tests passed across 3 files.

Full verification after final changes:

- Default `npm run test`: 938 passed, 1 failed (the known intermittent discovery-confinement attribution flake: expected `NON_REGULAR_OR_MULTILINK`, received `OPEN_IDENTITY_CHANGED`). Failure was preserved; no confinement check was changed.
- Serial `npm run test -- --maxWorkers=1`: 939 passed across 72 files.
- `npm run lint`: passed with 11 pre-existing warnings.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Actionable blockers / next decision

1. Approve or provide the owner/location and licensing basis for a reaction corpus. Then implement a bounded transformation-context retrieval contract before principle decisions; do not treat generic dense literature top-k results as reaction precedents.
2. Choose a durable shared PubChem-rate-budget design (database/RPC lease or dedicated single worker) before enforcing the global 1 request/sec limit.
3. Define and source a before/after process-inventory plus impact-factor contract before re-enabling screening estimates. Full LCA needs a separate method and provenance decision.
4. Independently diagnose the intermittent discovery-confinement test under parallel load. The serial pass is not a fix.
5. Authenticated SSE/persistence and recovery-worker behavior remain unexercised. No auth bypass was attempted.
