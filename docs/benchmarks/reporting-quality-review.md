# Reporting QUALITY review

**Verdict: PASS — narrow trusted-record projection only.** No blocking security or logic defects found in `lib/local-qualification/reporting.ts` and `tests/lib/local-qualification/reporting.test.ts`. Reviewed after the recorded SPEC PASS. This verdict does not approve scientific adjudication, artifact authentication, a public endpoint, or stage-runner integration.

## Findings

### No blockers within the reviewed boundary

- Validation rejects duplicate/foreign source references, unknown/duplicate stages, invalid enums, malformed hash references, and unsafe outcome counts before projection. Fixed `REPORT_INVALID` errors avoid interpolating input values.
- Explicit object reconstruction strips unknown extensions at manifest, source, result, and stage levels. Nested output objects and arrays are frozen; subsequent input mutation does not change an existing report.
- Every unique manifest source remains in the denominator, sorted by hash and assigned a synthetic case ID. Missing results and stages remain `not-run`, with unknown gates and unavailable baseline defaults for missing results.
- Acceptance is fail-closed across the independently checked 23-stage inventory, all five gates, baseline availability, useful outcomes, and adjudication-hash presence. Exhaustiveness and a nonempty cohort are additional completion requirements. `scientificCertification` is always false.
- This module performs no network, filesystem, credential, or chemistry operations. Trust still belongs to the caller: syntactically valid hashes and supplied acceptance flags do not establish artifact authenticity or scientific correctness. Hashes are deliberately retained; synthetic IDs are not a general anonymization guarantee.

### Nonblocking maintainability / regression-test improvements

1. **Persist independent inventory and negative-path coverage** (`tests/lib/local-qualification/reporting.test.ts:5–6,25–35`). The positive fixture derives stages from the production constant, so removing a required stage from that constant can leave the committed suite green. Add an independently enumerated inventory assertion, each unsuccessful stage status, each omitted stage, and `fail` as well as `unknown` for every gate. These paths passed this review's inline probes but are not preserved in the suite.
2. **Exercise validation branches directly** (`tests/lib/local-qualification/reporting.test.ts:49–51`). The test titled “unknown or duplicate stages” currently supplies no unknown stage; its duplicate example exceeds the array-length bound and can fail before duplicate detection. Add an unknown stage and a same-length duplicate replacing a different stage, plus invalid counts/hashes. Both stage branches passed independent probes.
3. **Preserve projection isolation tests** (`tests/lib/local-qualification/reporting.test.ts:42–47`). Persist multi-source ordering, unclassified and missing-case rows, nested extension omission, recursive freezing, and input-mutation isolation. The existing single-row test only covers part of this boundary.

## Execution evidence

All inputs were synthetic; no actual cohort was processed.

- `npm test -- tests/lib/local-qualification/reporting.test.ts`: **1 file, 8 tests passed**.
- Installed local ESLint on the two reviewed files: **exit 0**, no diagnostics.
- Independent local inline `tsx` assertions: **PASS**, with **23 required stages**, **148 negative acceptance checks**, and **8 invalid-record checks**. Also verified sorted IDs, missing-case denominators, unclassified split, private-extension omission at multiple depths, recursively frozen output, mutation isolation, and a positive complete case. These probes were not persisted as tests.
- No full application test suite, build, or type-check was run; this is not a repository-wide quality verdict.

## Integration gate — explicitly not approved here

`lib/local-qualification/stages.ts:4–16` uses `coverage`, not `source-inventory`, and does not include the four Python helper stages. This agrees with the delegated context's separate 19-stage runner versus the reporting inventory's 23 stages. A future integration adapter must explicitly map `coverage` to the source-inventory contract, include genuine helper-stage outcomes, and translate stage status semantics using trusted evidence. It must not equate a runner `candidate` with completed/adjudicated acceptance. The current report function is not evidence that this adapter or end-to-end qualification exists.

## Operational scope

Only this review document was written. No live calls, private inputs, credentials, installs, commits, stashes, resets, or source/test edits were performed. Cached Git references showed this worktree HEAD aligned with `origin/main`; local `main` was behind. Fetch was intentionally not run because this review prohibits live calls, so remote freshness was not independently established. An optional Python-based inventory recount was blocked by the execution policy; no approval settings were changed, and the integration note rests on source inspection and supplied context rather than that failed command.
