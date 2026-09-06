# Independent runtime SPEC re-review — R1

## Verdict

**PASS — narrow transport/attempt-ledger SPEC scope. R1 is resolved.** An unresolved durable reservation now stops further reservations even when settlement cannot persist an outcome. No new blocker was found in this correction. This is not independent quality approval or authorization for live execution.

**Production remains `LIVE_NOT_APPROVED`.** No actual provider/model calls, model discovery, private corpus/history reads, credential-file reads, installs, commits, pushes, or stage runs were performed. Only synthetic tests using test-created temporary directories were executed. Only this review document was authored.

## R1 acceptance findings

- **Stop does not depend on a successful settlement write:** `manifests.ts:117–135` derives `stopped = true` whenever a reservation has no outcome, whether its raw archive is absent or present. The original reserved amount remains charged. This closes the previous different-tuple bypass after caught settlement failure and lock release.
- **No compensating stop marker:** The stop is inferred from the already-durable reservation, not a second write after I/O failure. Normal lock acquisition/release still performs filesystem writes; “no write needed to stop” means no additional stop/outcome persistence is required. If lock acquisition itself cannot write, execution also fails before dispatch.
- **Transport is gated before dispatch:** `provider.ts:113–114` reserves under the lock before invoking the supplied transport at line 122. `manifests.ts:146–148` rejects new work when stopped. `settle()` can still finish the current reservation under its existing lock; no automatic reset or reconciliation was introduced.
- **Replay precedence retained:** Existing attempt identity rejects with `REPLAY` before the stopped check. The new interrupted-settlement tests explicitly check this; a next attempt or different tuple rejects with `LEDGER_STOPPED`.
- **Settled unknown-cost errors remain distinct:** An existing valid `COST_UNKNOWN` error outcome retains its full charge but does not trigger the missing-outcome stop. The original explicit-retry test still succeeds, with request/reservation consistency and attempt limits retained.
- **The actual caught-failure path is exercised:** Four injected faults cover raw creation, raw write, raw fsync, and outcome creation after a synthetic fetch ignores abort and reaches its deadline. Each asserts `PRIVATE_IO_ERROR`, an aborted signal, no outcome, and a removed lock. Once the transient fault clears, both a reopened provider and the original provider reject different tuples; total transport calls remain one. Final directory contents equal the post-failure contents, with no new reservation or stop marker. This is not merely stale-lock protection.
- **Reservation-only and raw-only interrupted history both stop:** The two additional ledger cases check reopening, full charge, replay, next-attempt rejection, and stopped state.

Relevant implementation: `manifests.ts:108–165`, `provider.ts:113–150`. Relevant new tests: `provider-manifests.test.ts:98–136`. The unchanged production rejection is at `provider.ts:91–92` and is tested at `provider-manifests.test.ts:218–222`.

## Independent execution evidence

Read the updated `manifests.ts`, `provider.ts`, complete provider/manifest test file, implementation evidence, and previous SPEC review. Also inspected repository instructions, lessons, package scripts, and Vitest configuration.

| Command / check | Observed result |
| --- | --- |
| `npm test -- tests/lib/local-qualification/provider-manifests.test.ts --reporter=verbose` | Exit 0; **49/49 passed**, one file; start `22:27:57`. All six new R1 cases individually passed. |
| `npm test -- tests/lib/local-qualification/provider-manifests.test.ts -t 'durable private spend ledger\|additional fail-closed regression gates\|strict serial OpenRouter boundary'` | Exit 0; **43 passed, 6 skipped**, one file; start `22:28:37`. Independently confirms the original three test groups remain present and green, separately from the six R1 additions. The displayed escaped pipes represent the shell command's literal regex alternation pipes. |
| `git diff --check` | Exit 0. This checks tracked diffs, not the untracked review document. |
| `git fetch` and branch/upstream inspection | Exit 0. Current research HEAD matches `origin/main` (`0/0`); separate local `main` is eight commits behind its remote and was left untouched. Existing shared-tree edits were preserved. |

The implementation report records **RED: 43 passed / 6 failed**, followed by **GREEN: 49 passed**. RED is implementer evidence, not independently replayed here: this reviewer did not revert or modify runtime code. Original test groups and expectations were inspected and independently rerun; a byte-for-byte reconstruction of the historical test file was not completed because local arbitrary-Python execution was approval-blocked. Ordinary `shasum` and targeted tests remained available. The provider's current SHA-256 exactly matches the prior review, confirming it was unchanged.

No whole-tree typecheck, lint, or broader suite was rerun in this deliberately narrow review. Earlier typecheck results belong to their respective execution snapshots and are not promoted to a current whole-tree PASS.

Reviewed SHA-256 fingerprints:

```text
0820a4c2f8d2548e0a444dd360f4028ddda813e3226527e45f07a8621b57ae61  lib/local-qualification/manifests.ts
65f1526f0f17c97e0d42d642172fa47810c191173ca0b441302d8c9a788e9c7c  lib/local-qualification/provider.ts
3e57484a07120f6ce857882857469dfb029ef07aba2ce4a9f4888f1526914089  tests/lib/local-qualification/provider-manifests.test.ts
dc94f8b7852ac9570bafab08e17e42ae18abaa5dc15295c3aacb396ac5fe8e2f  docs/benchmarks/runtime-implementation.md
```

## Boundaries that remain blocked or unverified

This acceptance closes only R1 in the serial synthetic runtime substrate. It does not supply a frozen, authenticated tuple manifest; stage/role identity or role-aware telemetry; source/evidence provenance; historical billing reconciliation; verified live tokenizer/pricing bounds; exact undiscovered model identities; or an actual smoke/pilot/repeated-run stage runner. It establishes no chemistry quality, cohort completeness, device performance, or production readiness.

Recovery of unresolved history remains an independently approved reconciliation operation, never an automatic budget reset. SPEC acceptance here does not replace the separate independent quality and integration/operational gates. **Keep `createProvider()` blocked with `LIVE_NOT_APPROVED`.**
