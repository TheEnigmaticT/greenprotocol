# Durable stage substrate — independent SPEC review

## Verdict

**PASS for the narrow, trusted-adapter stage substrate.** No blocking SPEC deviation found in `lib/local-qualification/stages.ts` or its targeted tests against the delegated requirements. This is **not** approval of integration, live execution, corpus qualification, scientific success, or the user's full mission. Independent QUALITY review remains separate.

## Scope and evidence

Reviewed the complete stage implementation, its 10 tests, `stages-implementation.md`, and the principle-contract inventory. Only this review document was written; shared implementation/tests were not altered. No model/provider invocation, corpus access, credentials, installation, commit, or push occurred.

Workspace freshness: `git fetch` succeeded; the active worktree branch `research/local-model-e2e-20260905` matched its upstream (0 ahead / 0 behind). The separately checked-out local `main` was 0 ahead / 8 behind `origin/main`; it was not modified. The worktree contains other concurrent changes outside this review.

Actual independent execution:

- `./node_modules/.bin/vitest run tests/lib/local-qualification/stages.test.ts`: **1 file passed, 10 tests passed**.
- `./node_modules/.bin/eslint lib/local-qualification/stages.ts tests/lib/local-qualification/stages.test.ts`: exit 0, no diagnostics.
- Additional inline `tsx` assertions: **PASS** for a literal expected 19-stage inventory, every dependency preceding its dependent, an installed job without a role yielding `unavailable` without invocation, downstream blocking, and all three safety/READY flags remaining false. These assertions did not add or modify test files.

## Requirement assessment

| Requirement | Assessment and evidence |
| --- | --- |
| Fixed inventory including all P1–P12 | PASS. `stages.ts:4–16` plus frozen `PRINCIPLE_IDS` enumerate extraction, coverage, claim-audit, P1–P12, applicability, assembly, rescore, acceptance. Independent literal-inventory probe avoids relying solely on the test suite's self-reference to `STAGES`. |
| Serial topological DAG | PASS. The awaited stage loop at `173–214` executes one job at a time under the adapter's global exclusion contract. A non-candidate prerequisite blocks the dependent (`197`). |
| Explicit non-success outcomes | PASS. Closed status/code vocabulary (`5–6,86–89`); absent jobs are unimplemented, absent roles unavailable, validation failures failed, and dependencies blocked (`195–202`). No missing work is converted to success. |
| Bound identities and versions | PASS within the trusted-manifest boundary. Preparation copies and freezes source/evidence/contract bindings and role/model/transport identities; manifest includes review ID, job implementation versions, DAG and timeout (`93–115`). Stage tuples also bind dependency result hashes (`174–178`). |
| Create-only durable metadata/replay contract | PASS as an interface, not verified disk durability. Store requirements are explicit (`66–74`); writes are read back byte-for-byte (`145–147`); saved results validate hashes, tuple fields and status/code shape (`183–190`). |
| No automatic retry after uncertain execution | PASS. Attempt is always 1; a saved start without a result becomes interrupted, never invokes again (`192–195`). Tests exercise result-persistence failure and replay without extra calls. |
| Global unresolved fence across cases/versions | PASS. A globally locked append-only fence is scanned before stage execution (`149–172`), opened before invocation (`201`), and left unresolved on deadline. Failure to write/verify a result or settlement also leaves the existing fence unresolved. An unresolved fence blocks future fresh work; version change cannot clear it. The targeted regression exercises changed evidence version after timeout. |
| Bounded asynchronous invocation | PASS within trusted cooperative execution. Timeout range is 1–60,000 ms; abort signal is passed; timeout returns failed/DEADLINE and halts new execution (`112,117–134,212`). No late result callback can append to the stage journal. |
| No false scientific certification | PASS. Even candidate acceptance produces literal `safetyCertified: false`, `allTwelveSafe: false`, `ready: false` (`215`). Every principle retains the explicit contract-only implementation marker (`178`). |
| Provider remains spending/allowlist authority | PASS for separation. This module imports only source hashing and principle contracts, not a live transport; it neither grants budget nor authorizes models or fallback. Exact approval/attestation remains an integration prerequisite. |

## Mandatory boundaries for integration

1. **Frozen role manifests are trusted configuration, not proof of approval.** `reviewId`, family and model strings are format checked; their authenticity, exact allowlist membership and served-model identity are not established here. The provider must enforce these independently. Do not describe the mutable-config rejection test as proving real review approval.
2. **Candidates are not scientific success.** An injected validator can return true for a synthetic artifact hash and produce candidates throughout the DAG. This is acceptable only because the substrate never certifies safety or readiness. Real artifact existence, provenance, content, chemistry semantics and independent applicability/acceptance decisions must be established outside it. Never map `candidate` mechanically to scientifically completed/passed.
3. **The supplied store is trusted, not a real disk implementation.** Current tests use an in-memory map. Production/private integration must prove create-only durable append, bounded reads, interprocess exclusion, trusted integrity and path/owner/access controls. Hash consistency is not authentication. All runs sharing a budget/execution domain must use the same durable global fence; replacing the store is not authorized recovery.
4. **A deadline is not proof that remote work stopped.** Timers cannot preempt blocking synchronous adapters or validators. The unresolved fence deliberately prevents new calls after timeout; it is conservative and has no automatic reset. Provider-owned spending and cancellation accounting remain required.
5. **Reporting is a separate contract.** The 19-stage inventory is approved here, not any larger reporting/helper inventory. Integration must explicitly map statuses and stage identities and retain missing helper work as missing; this review does not approve such a mapping.

## Non-blocking verification gaps

The existing suite covers replay, interruption, semantic rejection, corruption, role shape, version invalidation and the critical cross-version timeout fence. It does not establish real filesystem crash durability or cross-process locking. Further integration tests should exercise failure writing the global settled record, concurrent callers against the concrete adapter, the 4096-invocation fence cap, and independently vary model/role/transport/source/contract versions. These are not grounds to claim broader readiness from the present PASS.

**Disposition:** narrow SPEC gate passed; proceed only to independent QUALITY review and separately authorized integration gates. No live or scientific acceptance granted.
