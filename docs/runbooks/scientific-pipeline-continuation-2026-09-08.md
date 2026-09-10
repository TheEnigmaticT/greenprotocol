# Scientific pipeline continuation — 2026-09-08

## Scope observed

Work stayed on `feat/local-model-pipeline` at starting HEAD `7af3d21`. Existing dirty changes and local-model IDs were preserved. No reset, clean, stash, commit, push, merge, deployment, remote database migration, credential inspection, or protected-instruction-file change occurred.

## Completed: reaction evidence before principle generation

Files: `lib/predecision-evidence.ts`, `lib/pipeline.ts`, `lib/prompts/principles.ts`, `lib/types.ts`, `services/chemistry/main.py`.

- The pipeline now creates bounded `predecisionEvidence` after deterministic scoring and before its twelve principle calls.
- It reuses the score service's extracted `reaction_smiles`; it does not invoke a second reaction parse. The chemistry service now returns the representation in `smiles_extraction` alongside extraction metadata.
- The context preserves parsed material roles/declared quantities and conditions, plus at most three literature evidence unit identifiers, document IDs, source type, page bounds, DOI, quotes, candidate state, applicability note, limitations, and similarity.
- The decision boundary is explicit: dense semantic similarity is candidate context only, not a validated reaction precedent. The supplied context says no applicable reaction precedent is established without independent chemistry review. This does not make a chemical swap eligible; the existing later application gate remains in force.
- The context is persisted in the analysis result as `predecisionEvidence` so the decision input is inspectable on saved results.

Regression evidence:

- `tests/lib/predecision-evidence.test.ts` covers representation-present and representation-absent contexts.
- `tests/lib/pipeline-ranking.test.ts` captures actual mocked principle user payloads. It confirms all 12 payloads contain the score-service reaction SMILES and a retrieved source ID before principle generation.
- Focused TypeScript tests passed: 12 tests in 2 files.
- Serial web suite passed: `942 tests / 73 files`.
- `npx tsc --noEmit` passed with the focused run.

## Reaction corpus discovery

Searched the requested historical session (`20260907_200714_858ebf`) and targeted worktree/dev-root manifests, documentation, data roots, source references, and migrations. Findings remain:

- The active source uses model-extracted, RDKit-validated reaction SMILES for P2, now reused for predecision retrieval.
- `literature_evidence_units` is a literature evidence schema, with inputs/outputs/conditions fields, and the local dense index represents evidence units.
- No active ORD/USPTO reaction corpus, reaction rows, corpus owner/license record, or live ORD/USPTO query wiring was found in the inspected locations.
- The older 8,942-entry startup cache is chemical identity/reference data, not reaction rows.

No external corpus was imported. An external source decision is still needed only to add a new reaction corpus: source owner/location plus license/redistribution basis. Current literature retrieval is implemented and explicitly non-precedent when it lacks reaction applicability proof.

## Shared PubChem budget: authored and locally exercised at the HTTP boundary

Files: `supabase/migrations/20260908000000_add_pubchem_request_budget.sql`, `services/chemistry/reference_store.py`, `services/chemistry/pubchem.py`, `services/chemistry/test_pubchem_budget.py`.

- Added a non-applied Supabase migration defining a singleton `gpc_pubchem_request_budget` row and `acquire_pubchem_request_slot(1000)` RPC. It locks the row and uses server time; granted slots advance `next_allowed_at` one second. The migration was authored only, not deployed.
- `ReferenceStore.acquire_pubchem_request_slot()` fails closed when the RPC is absent/invalid.
- `fetch_pubchem_json()` acquires a shared slot immediately before each actual HTTP attempt. This covers properties, density, GHS callers, and retries because they all use that function. Cache hits do not reach this function. A denied slot produces retryable `rate_budget` state, not `not_found`.
- New isolated test verifies denial makes zero HTTP attempts and retains rate-deferral truth. Together with reaction-smiles and recovery tests, the targeted Python run passed 5 tests.

Limitation / regression requiring follow-up:

- Full Python suite: `124 passed, 2 failed`. `test_assistant_tools.py` expects DMF lookups to be `ok`, but its bare local test configuration has no Supabase rate-budget RPC. The new fail-closed behavior correctly blocks external PubChem traffic, then the existing local fallback cannot resolve this fixture, producing `not_found`. This is an integration/configuration issue, not a rate-limit test weakness. No test/check was weakened. The next fix should give the isolated assistant-tool fixture a local budget implementation or make it explicitly assert an unavailable/deferred outcome; production requires applying the authored migration before this behavior can be active.

## Impact inventories

No before/after screening implementation was added. The existing unavailable impact state was preserved because no complete substitution-specific inventory/factor contract exists in the current stored data. This avoids reintroducing equal-mass/default-mass claims. The minimum next implementation is a versioned inventory snapshot containing boundary, functional unit, declared/calculated quantity, unit, energy, material role, factor provenance, and explicit missing values; only complete supported scenarios should calculate `screening_estimate`.

## Browser, authenticated persistence, and recovery verification

- Existing Playwright auth test is a local unauthenticated UI/protection smoke only; it does not include an isolated authenticated database fixture.
- `npx playwright test tests/auth-flow.spec.ts` was attempted against the local app and timed out after 300 seconds. No credentials were inspected, guessed, or bypassed, and no production record was touched.
- Recovery worker behavior was exercised in the targeted Python test set (queue claim → lookup → cache write → resolved/retry/terminal status) with controlled fakes. It is not a real deployed worker/database verification.
- No authenticated UI → SSE → saved-record readback was completed because a dedicated local Supabase/auth integration environment is absent. The precise prerequisite is a local Supabase service with an approved disposable test user and the new migration applied locally; then test-created record IDs can be read back and deleted.

## Verification

- `npx vitest run tests/lib/predecision-evidence.test.ts tests/lib/pipeline-ranking.test.ts`: passed, 12 tests.
- `npm run test -- --maxWorkers=1`: passed, 942 tests / 73 files.
- `npx tsc --noEmit`: passed.
- `uv run --with-requirements requirements.txt python -m pytest -q test_pubchem_budget.py test_score_endpoint_full_principles.py::test_score_endpoint_extracts_reaction_smiles_when_missing test_recovery_worker.py`: passed, 5 tests.
- Full chemistry Python suite: 124 passed, 2 failed as described above.
- `git diff --check`: passed.
- Playwright auth smoke: timed out at 300 seconds; no external state modified.

## Not performed

No remote migration, deployment, commit, push, merge, or release was performed. No claim is made that the hosted application, database persistence, worker, or distributed rate budget has been verified live.
