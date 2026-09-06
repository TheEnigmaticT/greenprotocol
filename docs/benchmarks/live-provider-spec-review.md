# Live provider SPEC review — BLOCKED, live gate OFF

Independent review of `provider.ts`, `manifests.ts`, implementation handoff and both provider test files. This is not QUALITY approval or authorization to enable anything.

## Blocking finding

**S1 — selected endpoint completion limit is not enforced.** `provider.ts:76` accepts up to 32768 completion tokens regardless of selected endpoint. The unauthenticated official endpoint catalog fetched during this review reports `deepinfra/turbo` context 262144 and `max_completion_tokens: 16384`; `coreweave/fp4` also has context 262144 but reports a different completion ceiling (235929). Requests exceeding DeepInfra's advertised limit can therefore reach transport instead of failing preflight. Enforce a reviewed endpoint-specific ceiling, or explicitly use a conservative common ceiling. Add a regression with `providerSlug: 'deepinfra/turbo'`, verify 16384 accepted and 16385 rejected before fetch. The existing completion-limit test lacks an endpoint, so its claim of a universal catalog maximum should also be clarified.

Actual command:

```text
./node_modules/.bin/vitest run tests/lib/local-qualification/provider-manifests.test.ts tests/lib/local-qualification/live-provider.test.ts
Test Files: 1 failed | 1 passed (2)
Tests: 1 failed | 57 passed (58)
```

Failure: `live-provider.test.ts:65`, `rejects completion limits beyond the verified catalog maximum`; request with 16385 resolved successfully against synthetic transport instead of rejecting. SPEC cannot pass while this required regression is RED. Historical TDD claims in the handoff were not independently reconstructed.

Catalog evidence: https://openrouter.ai/api/v1/models/google/gemma-4-31b-it/endpoints (public read only).

## Activation prerequisites, not permission to integrate

`REVIEW_INPUTS` currently pins provider, manifests, stages and discovery source, plus review documents. It does **not** pin `reporting.ts`, `stage-store.ts`, `extraction-jobs.ts`, `principle-jobs.ts`, or their source/graph/audit/evidence/decision/principle dependencies. Before enablement, expand pins to the complete integrated role-module and runner dependency closure and its independent SPEC then QUALITY reviews. Matching hashes alone do not establish review verdict, order or authority. The handoff correctly acknowledges this limitation; this review does not bless the unintegrated pipeline or claim all-stage no-fallback coverage.

## Verified within this delta

- Frozen `LIVE_APPROVAL.approved = false`; native constructor checks approval before creating ledger/transport. Immutable-OFF synthetic regression passes. No gate edits or approval artifact created by this reviewer.
- Token plus required current source/document hashes are validated at construction and before execution; synthetic missing/stale/wrong-token tests pass.
- Exact Gemma ID only; mission source/contract/role-model metadata binding, defensive copying, required live provider slug, no fallback and returned model/provider checks are present. Full prompt reservation is exactly 262144; both selected endpoints advertise that context. DeepInfra turbo tool requests fail closed.
- Fixed module-derived attempts root; old root ledger/lock blocks automatic migration. New sprint initializes at zero and $100 cap; existing header spend is retained and mission changes reject. Historical experiments remain excluded, not reset into this sprint. No private ledger was opened to independently audit prior usage.
- Shared synthetic/native execution core has fsynced pre-call reservations, integer rounded-up micro-USD accounting, bounded private raw archives, available token/cost/model/provider/latency/status telemetry, serial lock, full-body deadline and persistent uncertain/crashed-attempt stop behavior. Relevant ledger regressions pass; unavailable telemetry remains null, not invented.

## Snapshot and boundaries

Reviewed source SHA-256:

- provider.ts: `8e08c9bf0d3e28cd21adeaa5296a4f17cce97a2920da3a685ec0dd85b13fcdf5`
- manifests.ts: `0b7f5e9e2e56428a24a8fb5213faca8f010cc963ef52259bccd68c41b7b15e66`

Fetched remotes; current research HEAD equals origin/main (0 ahead/0 behind). Separate local main is behind origin/main by 8 and was untouched. Shared worktree has unrelated in-progress files; no stash, merge, commit or implementation changes made. Required absolute dev-protocol file was absent. A Python `-c` metadata command was denied by the approval layer; no approval setting was changed. Hashes were obtained using `shasum`.

Only this report was written. Tests used synthetic fixtures/transports; no inference calls, credential-file reads, corpus reads, private ledger changes, live switch changes or release approvals were performed. Fix S1, rerun the actual targeted tests, obtain fresh SPEC review, then proceed to independent QUALITY review. Keep the live gate OFF throughout.
