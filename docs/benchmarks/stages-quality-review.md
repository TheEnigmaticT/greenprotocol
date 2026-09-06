# Durable stage substrate — independent QUALITY review

## Verdict

**PASS for the narrow, trusted-adapter substrate, with non-blocking follow-ups.** No blocking correctness or security defect was established in the reviewed implementation. This is not approval of the full mission, live execution, private-disk durability, integration, scientific acceptance, or READY.

The implementation and test files were reviewed without modification. Only this report was created. No private corpus, credentials, model/provider calls, installations, commits, or pushes were used.

## Independently verified

- `./node_modules/.bin/vitest run tests/lib/local-qualification/stages.test.ts`: **1 file passed, 10 tests passed** (126 ms reported duration).
- `./node_modules/.bin/eslint lib/local-qualification/stages.ts tests/lib/local-qualification/stages.test.ts`: exit 0, no diagnostics.
- `./node_modules/.bin/tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --skipLibCheck lib/local-qualification/stages.ts tests/lib/local-qualification/stages.test.ts`: exit 0, no diagnostics.
- `git diff --check` for the two reviewed paths: exit 0. These files are untracked, so this command is not independent whitespace coverage of their contents.
- `git fetch` succeeded. Active branch `research/local-model-e2e-20260905` is at its `origin/main` upstream. Separately checked-out local `main` is 0 ahead / 8 behind; no branch was changed. Other lanes have concurrent changes, outside this review.

Reviewed source snapshot, SHA-256:

| File | Hash |
| --- | --- |
| `lib/local-qualification/stages.ts` | `6f7a01eb63c0cb0db5198505022bd10ac6b9e1ad0b333043ac20af8898458ef9` |
| `tests/lib/local-qualification/stages.test.ts` | `70b6e8b04d94816de27a34f96c6829609a7b1983c928ba354e9f3e1ce0b0ced4` |

Also read the complete SPEC review, implementation report, source-hashing helper and principle contracts. Earlier reports' additional probes and regression totals are not presented as this review's execution evidence.

## Quality assessment

- **Control flow and dependency safety:** The fixed, frozen stage graph and awaited execution loop are straightforward to inspect. Non-candidate dependencies block downstream invocation. Missing jobs and identities remain explicit rather than becoming success (`stages.ts:7–16,173–203`).
- **Replay identity:** Preparation snapshots binding and role fields; the manifest includes reviewed identity/version fields, implementation versions, DAG and timeout. Stage identity incorporates dependency-result hashes (`93–115,174–179`). Persisted results check their digest, expected tuple metadata, allowed status/code combination and field count before reuse (`183–190`).
- **Conservative failure handling:** Durable starts precede execution. An interrupted start never automatically invokes again. Result-write uncertainty leaves an unresolved global fence. Deadline results do not settle that fence, and future changed-version work sees the same halt (`155–172,193–212`). This is deliberately availability-conservative rather than a retry mechanism.
- **Output/privacy boundary:** Jobs supply only artifact references to the substrate. Execute/validation failures normalize to closed codes instead of persisting arbitrary exception text. Candidate hashes require the expected format and the synchronous semantic validator must return literal true (`117–134`). Store exceptions can propagate; callers still must avoid exposing arbitrary adapter errors publicly.
- **No scientific or spending overclaim:** Every return fixes `safetyCertified`, `allTwelveSafe` and `ready` to false. Principle implementation markers remain contract-only. No provider transport, spending ledger or model authorization mechanism is introduced (`137–138,178,215`).

## Non-blocking follow-ups

1. **Make boundary tests permanent.** Existing tests compare stage order to the exported `STAGES`, so a mistaken graph edit can update both sides implicitly. Add a literal expected inventory and dependency-edge assertions. Independently vary source, contract, model, role, transport, review and implementation versions; current version test changes evidence only. References: `stages.test.ts:26–54,99–108`.
2. **Exercise fence transition failures.** Add deterministic tests for settlement-write failure, late job resolution after deadline, corrupt/orphaned fence entries, exact 4096-invocation exhaustion, and same-tuple versus changed-tuple resumption after each failure. The critical cross-version deadline case is already covered. References: `stages.ts:158–172,201–209`; `stages.test.ts:63–85,109–125`.
3. **Align metadata bounds before disk integration.** The store contract promises reads bounded to 16 KiB, while preparation validates individual token lengths but does not explicitly check the serialized manifest byte size. Add a maximum-length configuration test against the concrete adapter and reject any oversized manifest before writing it. This review did not establish a concrete oversized accepted payload; treat this as a boundary-verification gap, not a reproduced bug. References: `stages.ts:66–69,83,95–115,150–153`.
4. **Keep trusted-job assumptions explicit.** Callback functions are captured, but bound to the original job object; `Object.freeze` does not freeze callback closures or mutable receiver state. Job authors must maintain implementation-version discipline and avoid changing semantics during execution or replay. Timers cannot preempt synchronous blocking code or prove remote cancellation. These are trusted-adapter constraints, not sandbox guarantees. References: `stages.ts:105–107,117–134`.
5. **Improve audit readability when ownership reopens.** The persisted-result predicate at line 188 combines several independent invariants in one long expression. A named parser/validator with equivalent negative tests would make future schema changes easier to review. No refactor is requested in this frozen lane.

## Verification limits and disposition

Additional inline exploratory probes were attempted for maximum manifest sizing, settlement-write failure, late completion and fence exhaustion, but execution policy blocked inline scripts. A separate Python calculation was also blocked. **Those probes did not run and are not PASS evidence.** Existing installed test/lint/typecheck commands did run successfully. No source/test edits or temporary probe files were introduced to work around the restriction.

The Map-backed test store does not prove interprocess serialization, filesystem permissions, fsync/crash durability, bounded I/O, integrity authentication, or shared execution-domain ownership. Those remain mandatory for the separate real-disk lane. Frozen role metadata does not authenticate model approval; the provider remains sole approval/attestation/budget authority. Candidates remain candidates, including at acceptance.

**Disposition:** narrow QUALITY gate passed for the identified snapshot. Proceed only to separately reviewed integration and adapter verification; do not translate this verdict into scientific completion or live authorization.
