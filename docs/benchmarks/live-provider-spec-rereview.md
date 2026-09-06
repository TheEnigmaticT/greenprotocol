# Live provider SPEC re-review — PASS for S1 closure; live gate OFF

## Verdict and scope

**PASS for the conservative completion-limit S1 fix and the reviewed provider/manifests unit.** The blocking completion-limit finding in `live-provider-spec-review.md` is resolved in the current source and independently rerun synthetic tests. This is a narrow SPEC re-review, not QUALITY approval, activation authorization, dependency-closure approval, or completion of the full qualification mission. Preserve the earlier FAIL report as historical evidence.

Reviewed the current `lib/local-qualification/provider.ts`, `lib/local-qualification/manifests.ts`, both provider test files, the implementation handoff and the historical SPEC report. No implementation changes were made by this reviewer.

## S1 resolution

- `provider.ts:10` now freezes `MODEL_COMPLETION_LIMIT['google/gemma-4-31b-it']` at **16384**.
- `provider.ts:74–77` validates the exact allowed model and bounds completion tokens with that ceiling. The integer predicate in `manifests.ts:13` is inclusive and rejects negative, non-integer and non-finite values; the provider also rejects zero.
- `provider.ts:161–165` runs this validation before reading the credential environment variable, acquiring the ledger lock, reserving spend or invoking transport. Oversized requests therefore fail preflight.
- This is the **conservative common mission ceiling** across `deepinfra/turbo` and `coreweave/fp4`, not a claim that every endpoint advertises the same maximum. It takes the lower ceiling documented in the prior public catalog review; CoreWeave's higher advertised capacity is deliberately unused. This review did not re-fetch external model metadata or assert its present availability.
- `live-provider.test.ts:63–69` rejects 16385 for each exact pinned endpoint and the unpinned synthetic case, asserting zero fetch calls.
- `live-provider.test.ts:70–78` accepts 16384 for both pinned endpoints with matched returned provider names and exactly one synthetic fetch each. The common guard is shared by native and synthetic execution paths; native operation remains unreachable while OFF.

No remaining S1 blocker or regression was found in this narrow delta. Earlier RED/TDD results are historical handoff evidence, not results reconstructed by this reviewer.

## Independent execution

Command executed from the specified worktree, using the already installed local binary:

```text
./node_modules/.bin/vitest run tests/lib/local-qualification/provider-manifests.test.ts tests/lib/local-qualification/live-provider.test.ts

Test Files  2 passed (2)
     Tests  60 passed (60)
Duration   1.89s
```

The two suites exercise synthetic transport and temporary fixture ledgers, including immutable OFF, current/missing/stale input pins, wrong approval token, endpoint/model mismatch, mission binding, context reservation, no fallback, durable budget/retry protection, uncertain settlement, private archive safeguards and deadline behavior. These tests do not establish end-to-end coverage of every integrated role or runner.

## Operational boundary and mandatory future gates

- `LIVE_APPROVAL` remains `Object.freeze({ approved: false })`. Native construction checks approval before constructing transport or ledger; its OFF/no-network regression passes.
- The fixed approval artifact `docs/benchmarks/live-provider-approval.json` is absent, checked by existence only. This reviewer created no approval artifact and changed no switch.
- **Dependency-closure pinning remains mandatory before any future enablement.** Current `REVIEW_INPUTS` still omits `reporting.ts`, `stage-store.ts`, `extraction-jobs.ts`, `principle-jobs.ts` and their complete integrated source/graph/audit/evidence/decision/principle and runner dependencies. Expand pins to the actual reviewed closure and its independent SPEC then QUALITY evidence before a separate authorized release change.
- Current pins still reference the historical `live-provider-spec-review.md`; a future release must explicitly bind the authoritative fresh re-review and subsequent QUALITY verdict, not treat the old FAIL document or mere matching hashes as approval. Verify review order, verdict, provenance and user authority separately.
- The existing fixed attempts-root, new-sprint zero baseline, $100 cap, retained historical header spend, mission binding and reconciliation guards are unchanged. No real/private ledger was opened, reset or audited here.
- Task context reports the user's actual metadata attempt stopped with `DISCOVERY_UNSAFE_PATH` and made no paid calls. That remains a separate unresolved mission boundary, not a successful discovery or live inference result; this reviewer did not repeat or independently verify that attempt.

## Exact reviewed snapshot

Git HEAD: `30f252000a86ade611e688291d40eec399edf541`.

SHA-256 values computed with `shasum -a 256` after the test run:

| File | SHA-256 |
| --- | --- |
| `lib/local-qualification/provider.ts` | `eca6eca0737e70320893f68794b0042e9486eb0daed200d3803a415226582a0e` |
| `lib/local-qualification/manifests.ts` | `0b7f5e9e2e56428a24a8fb5213faca8f010cc963ef52259bccd68c41b7b15e66` |
| `tests/lib/local-qualification/live-provider.test.ts` | `77ef50739701a473368d0bb07ad976c00d50832bc0ea4272abd212fddef6c039` |
| `tests/lib/local-qualification/provider-manifests.test.ts` | `bb5eb352e7810ab6a2bb0a329bd8908299ecb1bd9fdde54b992576ab5202e554` |
| `docs/benchmarks/live-provider-implementation.md` | `eda89c0d266ba107059e6288ccd6f17b857107ef72bc2f733a565342b84441d8` |
| `docs/benchmarks/live-provider-spec-review.md` | `bcdeff9db9d5a85c3a69f0121703754f5bb0c7f2c63e73661c0477477ab1ef3f` |

Fetched remotes before writing; the current research branch is 0 ahead/0 behind its upstream `origin/main`. Separate local `main` is 8 behind and was untouched. Existing shared dirty work was neither stashed nor reconciled nor modified. The required absolute dev-protocol file was absent; repository instructions and `lessons.md` were read.

Only this re-review report was written. No live inference, external catalog fetch, credential-file access, corpus access, private ledger access, install, commit, push or release action occurred. Independent QUALITY review is still required; keep the immutable live gate OFF.
