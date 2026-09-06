# Independent final runtime quality/security review

## Verdict

**APPROVED — narrow injected synthetic transport/attempt-ledger unit only, after SPEC R1 acceptance. No blocking quality/security finding in this bounded scope.**

**Live execution remains NOT APPROVED. `createProvider()` must continue to fail with `LIVE_NOT_APPROVED`.** This approval is not a frozen tuple-manifest, stage/role telemetry, corpus, billing, scientific-quality, integration, or production certification.

Reviewed the complete `lib/local-qualification/provider.ts`, `lib/local-qualification/manifests.ts`, and `tests/lib/local-qualification/provider-manifests.test.ts`, plus implementation evidence and both SPEC review documents. No runtime or test code was changed. Only this artifact was authored. No actual models, corpus, credential files, installs, commits, pushes, or live stage runs were used.

## Independent verification

| Check | Actual result |
| --- | --- |
| `npm test -- tests/lib/local-qualification/provider-manifests.test.ts --reporter=verbose` | Exit 0; **49/49 passed**, one file; start `22:30:42`. Includes all six R1 cases. |
| `npm run lint -- lib/local-qualification/provider.ts lib/local-qualification/manifests.ts tests/lib/local-qualification/provider-manifests.test.ts` | Exit 0; no diagnostics. |
| `git diff --check` | Exit 0; applies to tracked changes, not proof of untracked artifact coverage. |
| `git fetch` and branch comparison | Current research branch matches upstream `origin/main`, 0/0. Separate local `main` is eight behind and was left untouched. Shared dirty worktree preserved. |

No whole-tree typecheck, build, or broader suite was run. Prior typecheck results remain historical evidence, not a current quality-review claim. No reverting/stashing shared changes or replaying historical RED was needed for this independent review.

Reviewed SHA-256 fingerprints, independently obtained with `shasum -a 256` and matching the accepted SPEC snapshot:

```text
65f1526f0f17c97e0d42d642172fa47810c191173ca0b441302d8c9a788e9c7c  lib/local-qualification/provider.ts
0820a4c2f8d2548e0a444dd360f4028ddda813e3226527e45f07a8621b57ae61  lib/local-qualification/manifests.ts
3e57484a07120f6ce857882857469dfb029ef07aba2ce4a9f4888f1526914089  tests/lib/local-qualification/provider-manifests.test.ts
```

## Quality/security findings

- **Race and lock lifetime:** `manifests.ts:63–80` uses exclusive creation and holds the lock through the provider's asynchronous operation, including settlement. The competing-provider test proves a second transport is not invoked. Preexisting crash locks fail closed; no automatic stale-lock reclamation exists. This is a serial ledger, not a queuing scheduler.
- **R1 crash/I/O recovery:** `manifests.ts:117–135` charges and stops on every unresolved reservation, whether raw bytes are absent or partially present. The durable reservation precedes dispatch (`provider.ts:113–122`). Four real-filesystem/injected-fault cases exercise raw creation, write, fsync, and outcome creation after an abort-ignoring deadline; they independently passed. Original and reopened providers reject different tuples after the transient fault clears, without another dispatch or compensating stop write. Reservation-only and raw-only history also stop. Corrupt/partial outcome JSON rejects rather than unlocking work.
- **Resume identity and explicit retries:** Duplicate attempt identity fails before a new write. Attempts are explicitly numbered and bounded to 1–3; retries require a preceding error plus unchanged serialized-request hash and reserved amount (`manifests.ts:143–156`). Successful attempts cannot be retried. Persisted retry chains are checked on read. Existing historical spend is read from the header rather than reset from a new constructor argument. Settled unknown-cost errors retain their full reservation and the intentional explicit-retry path; unresolved execution remains stopped.
- **Snapshot and immutable request prices:** `provider.ts:103–110` clones request data and captures the validator reference before yielding. The serialized body, including price limits, is hashed; retry reservation equality separately prevents changing the token-derived allowance. Mutation regressions for returned-model expectation and validator replacement pass. This does not freeze external state captured by validator closures.
- **Integer budget and cap:** Decimal-number costs/prices are rounded upward into safe integer microUSD; reservation and cumulative addition use BigInt. Invalid/nonfinite/negative prices and unsafe budget inputs reject. Reservation is checked against the persisted cap before dispatch; observed overruns persist actual spend and stop. Unknown costs do not release reserved spend. These guarantees are conditional on supplied pricing/input bounds, not independently verified provider billing or live tokenization.
- **Bounded transport and raw retention:** Fetch and body reads race the same deadline. Abort-ignoring deadlines, transport errors, and response overflow durably stop subsequent reservations. Archive memory/output is bounded to the configured limit, at most 4 MiB; overflow retains a prefix, and body deadlines retain received bytes. Plaintext HTTP errors preserve their error classification and raw body. Available parseable usage is accounted before response acceptance. Raw-write failure rejects rather than returning a validated result, with R1 protecting resume.
- **Private storage/error boundary:** Validated hash-derived filenames, checked directory components, exclusive/no-follow file creation, 0700 root, 0600 files, ownership/link checks, raw-content hashes, and file/directory fsync provide appropriate private-file hygiene for the documented local boundary. Tamper, symlink, hardlink, and crash-lock tests pass. Transport exceptions are reduced to static error codes; request authorization is not intentionally serialized into ledger metadata. Raw provider content remains private and is not claimed to be sanitized.
- **Response acceptance/live gate:** Exact approved model and returned-model equality, no fallback, strict requested output mode, finish reason, refusal/tool-name/count checks, and mandatory synchronous `validate(value) === true` are enforced. Production rejection is directly exercised. No shell execution, dynamic evaluation, database query, or credential-file loading exists in these reviewed runtime files.

## Non-blocking boundaries and follow-up

1. **Trusted test harness, not a network sandbox:** `NODE_ENV=test` and rejecting native fetch identity do not prevent an injected wrapper from making network calls. Constructor options and validator closures are trusted caller-owned configuration; immutable request snapshotting is not general sandboxing. Only synthetic transports were exercised here.
2. **Deadline scope:** Timers bound asynchronous fetch/body waiting under a responsive event loop, not arbitrary synchronous validators, parsing, filesystem stalls, or a malicious injected transport that blocks the event loop. No hard real-time claim is approved.
3. **Filesystem threat model:** Path checks/no-follow final opens do not eliminate adversarial ancestor replacement by a process able to mutate those directories. Same-UID hostile mutation, malicious history rewrite with recomputed hashes, power-loss simulation, and exhaustive filesystem fault injection were not certified. Existing tests cover cooperative contention and the named failure paths, not every crash interleaving.
4. **Integration gates remain separate:** Caller-supplied `tupleHash` is not an authenticated frozen tuple manifest; the validator is not an independent local JSON Schema engine. Stage/role identity, telemetry, corpus provenance, historical billing reconciliation, live-safe tokenizer/pricing bounds, exact undiscovered model identities, and actual stage orchestration remain outside this unit approval.

**Disposition:** Accept this synthetic runtime unit's quality/security gate at the fingerprints above. Keep live creation blocked. Any change to the reviewed runtime or expansion into paid/integrated execution requires the corresponding independent review and operational approvals.
