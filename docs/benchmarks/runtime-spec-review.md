# Independent runtime SPEC review

## Verdict

**CHANGES REQUIRED — one durable fail-closed error-path blocker remains in the narrow transport/attempt-ledger substrate.** The five reported recovery regressions pass independently, but that does not cover settlement I/O failure after uncertain cancellation. No live, cohort, stage-runner, scientific-quality, or release approval is granted.

`createProvider()` remains correctly blocked by `LIVE_NOT_APPROVED`. The user's authorization for gated real calls does not resolve denied private access, unknown historical spend, incomplete identity/evidence freezes, or the separate implementation/review gates. Do not enable it on the strength of this review.

## Scope and verification

Read `provider.ts`, `manifests.ts`, `provider-manifests.test.ts`, and `runtime-implementation.md` in full. Also read the public corpus/contracts review documents, cohort checkpoint, repository instructions/lessons, package scripts, and Vitest configuration. No original/private data, credentials, model discovery, or model endpoint was accessed. Only synthetic existing runtime tests were executed; no new fault-injection test was added. Only this review document was authored.

Independent commands and actual results:

| Command | Result |
| --- | --- |
| `npm test -- tests/lib/local-qualification/provider-manifests.test.ts` | Exit 0; **43/43 tests passed**, one file; start 22:19:03. |
| `./node_modules/.bin/tsc --noEmit --incremental false` | **Exit 2**. Diagnostics are in `contracts.test.ts` and `evidence.test.ts`, including missing `reasons`, `policy`, `auditReference`, and candidate fields plus readonly assignments. No runtime provider/manifest diagnostic was printed. This is not a current whole-tree typecheck PASS. |
| `git diff --check` | Independently rerun after the failed typecheck; exit 0. |
| `git fetch` and upstream inspection | Current research HEAD matches its upstream `origin/main`; separate local `main` is behind its remote and was not modified. Existing shared-tree edits were preserved. |

The implementation document's earlier green typecheck remains historical evidence, not the result of this review's later shared-tree execution. Whole-suite tests and lint were not independently rerun here.

Reviewed SHA-256 fingerprints (uncommitted files are not identified by HEAD alone):

```text
65f1526f0f17c97e0d42d642172fa47810c191173ca0b441302d8c9a788e9c7c  lib/local-qualification/provider.ts
a8a49972f5a8a8a09806325a8c688ab87e360d07ed45ee51bddd120064cb4e7b  lib/local-qualification/manifests.ts
abb1a8d223f46470581909429d2a0d83ce05d371d4c43c66607af43c60de3b5f  tests/lib/local-qualification/provider-manifests.test.ts
97c40d0485e34efce1ecbafaf7bd424491507649346e60f5514af03d2ee9bebb  docs/benchmarks/runtime-implementation.md
```

## Blocking finding R1 — failed settlement can lose the durable cancellation stop

**Locations:** `provider.ts:143–150`; `manifests.ts:73–79,117–128,139–149,152–158`.

The stop for `DEADLINE`, `TRANSPORT_ERROR`, or `RESPONSE_TOO_LARGE` is derived only from a successfully persisted outcome. `ledger.settle()` can instead throw while writing/fsyncing the raw archive or writing the outcome. `withLock()` releases the lock even when that asynchronous operation rejects. A reservation without an outcome, including one with a partial/raw-only archive, retains its reserved cost but **does not set `stopped`**. A different tuple can therefore reserve and invoke transport once a transient filesystem problem clears, even though the preceding request's cancellation was never confirmed.

Concrete source-level failure sequence:

1. Reserve and fsync before fetch; the transport ignores abort and times out.
2. `code` becomes `DEADLINE` and the transport requests abort.
3. Raw archive creation succeeds, but its write/fsync fails before an outcome can be persisted, or outcome creation fails before producing a file.
4. Settlement rejects; the promise's `finally(release)` removes the lock.
5. Reopening sees a valid reservation and possibly a readable raw-only file. `state()` charges the reservation but leaves `stopped` false. Another tuple is allowed if the budget permits.

This is not the normal process-crash path, where the intentionally unreclaimed lock protects the ledger. It is a caught settlement I/O failure in a still-running process. Retaining spend alone does not satisfy the serial/uncertain-cancellation invariant. The existing 43 tests do not inject this failure; this finding is based on control-flow inspection, not a claimed reproduced regression.

**Required acceptance:** Make incomplete post-dispatch settlement fail closed independently of successfully writing an outcome. For example, reject further reservations whenever an unresolved reservation is present, or preserve a fail-closed lock/dispatch marker until settlement is durable. Do not rely on writing a stop marker after the filesystem has already failed. Keep unknown-cost *settled* errors distinct from unresolved execution. Add synthetic fault-injection tests for raw write/fsync failure and outcome creation failure after an abort-ignoring deadline, then reopen the ledger and verify no second transport call occurs. Recovery must remain an independently approved reconciliation procedure, not a reset.

## Requirements met in the exercised normal-I/O boundary

| Requirement | Assessment |
| --- | --- |
| Live gate and exact identity | PASS. Production provider always rejects. Test API requires test environment and an injected fetch, rejects native fetch identity, and permits only exact `google/gemma-4-31b-it`; Qwen IDs and aliases are not guessed. Injection is a trusted testing boundary, not proof that an arbitrary supplied function cannot make network calls. |
| No fallback / strict response gate | PASS. One model, fallback disabled, required parameter support, forced exact tool name/count or JSON output, finish-reason checks, returned-model equality, refusal rejection, and mandatory synchronous `validate(...) === true`. Local schema correctness ultimately depends on the supplied trusted validator; no independent JSON Schema engine runs here. |
| Snapshot before asynchronous work | PASS. Request data is deeply cloned and validator reference captured before preparation/transport; model and validator mutation regressions pass. This cannot freeze mutable state captured inside a validator closure. |
| Serial execution | PASS through successful settlement. The exclusive lock spans reservation, fetch, bounded body consumption, validation, and settlement. Contenders reject before transport. **R1 qualifies error-path durability.** |
| Deadline and raw archive | PASS for asynchronous fetch/body deadline and bounded archive. HTTP plaintext errors retain their HTTP classification and raw bytes; available parseable error-envelope costs are extracted. Overflow retains only the bounded prefix. This is not a CPU deadline for arbitrary synchronous validators or synchronous filesystem work. |
| Budget arithmetic | PASS for supplied bounds: safe integer microUSD, upward decimal conversion, BigInt accumulation/reservation, fixed maximum 100,000,000 microUSD, reserve-before-fetch, historical-spend requirement, and overrun stop. No verified live tokenizer bound exists. |
| Attempt persistence | PASS. Explicit attempts 1–3 only; no implicit retry; duplicate attempt replay rejected; retries preserve request hash and reserved amount; success cannot be retried. Existing headers do not reset historical spend on reopening. Unknown-cost settled attempts retain their full reservation. |
| Private file hygiene | PASS within documented filesystem assumptions: fixed module-derived production root, 0700 root/0600 files, no-follow/exclusive file opens, ownership/hardlink checks on reads, content hashes, file/directory fsync, corruption rejection, no automatic stale-lock reclamation. Not a sandbox against same-UID ancestor mutation. |
| Normal cancellation outcomes | PASS when settlement completes. Deadline/transport/oversize codes persist a stop across reopen. This is exactly the behavior recovered by the existing timeout regression, not coverage of R1. |

## Missing integrated obligations — not supplied by this unit

- **Frozen run identity:** `tupleHash` is caller-supplied and format-checked, not recomputed from a frozen approved manifest. The request hash binds serialized request bytes, not an authenticated source/cohort/split, baseline, evidence packet, stage/role, contract/prompt/validator version, model discovery record, or run configuration. These bindings must be constructed and verified by an independently reviewed integration.
- **Source and evidence provenance:** The denied corpus access remains denied. The public loader review describes protocol identity/counts, not an evidence-ready cohort. Frozen evidence/baselines, duplicate-resolution policy, exact historical Qwen IDs, and cumulative historical billing reconciliation remain unavailable/unverified.
- **Role-aware telemetry and reports:** The provider returns value/model/tuple/attempt/cost/request hash; outcomes store status/code/cost/raw hash. There is no durable stage/role/contract manifest, input/output token telemetry, latency/timing record, gate lineage, or safe report aggregation here. Do not treat these attempt files as a completed qualification report.
- **Actual stage runner:** No smoke → pilot → repeated-run orchestration, P1–P12 execution jobs, independent source/evidence auditors, integration-owned validation authority, substantive case acceptance, or saved renderable real results is implemented by the reviewed files. The checkpoint marks these not run or not integrated.
- **Live spend guarantee:** The UTF-8-byte-plus-allowance prompt estimate is explicitly not a proven tokenizer bound. Supplied prices and historical spend are not authenticated by synthetic tests. Reconcile history, establish live-safe price/token limits and exact approved identities, and complete SPEC then independent quality/operational approvals before enabling any paid transport.

**Disposition:** Fix and independently verify R1 before narrow runtime SPEC acceptance. Missing integrated obligations remain separate blocked deliverables; neither passing mock tests nor this review establishes chemistry quality, cohort completeness, local-device performance, or permission to bypass access/spend gates.
