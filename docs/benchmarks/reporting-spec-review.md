# Reporting SPEC review

**Verdict: PASS — narrow trusted-record projection only.** No spec blockers found in `lib/local-qualification/reporting.ts` and `tests/lib/local-qualification/reporting.test.ts` for the delegated scope. This is not scientific acceptance validation, artifact authentication, or runner integration approval. Separate QUALITY review is next.

## Verified

- Manifest source hashes are validated and unique; result rows must reference a manifest source exactly once. Every manifest source produces one sorted, synthetic-ID row. Missing results and missing stages remain explicit `not-run`; calibration, previous-holdout, and unclassified splits are preserved.
- The required inventory contains all 12 principles plus extraction, source inventory, claim audit, applicability, scenario assembly, rescore, four Python helpers, and acceptance (23 stages).
- A case is accepted only with every required stage completed, all five gates passing, baseline available, a positive safe-integer useful-outcome count, and a syntactically valid adjudication hash. A cohort is complete only if exhaustive, nonempty, and every case accepted. Failed/unknown gates, unsuccessful/missing stages, zero useful outcomes, unavailable baselines, and absent adjudication references cannot qualify.
- Output is explicitly reconstructed, dropping unknown/private extension fields, with fixed validation errors and `scientificCertification: false`. No chemistry inference, I/O, artifact lookup, or authenticity claim occurs in this module.

## Execution evidence

- `npm test -- tests/lib/local-qualification/reporting.test.ts`: **8 tests passed**.
- Local ESLint on the two reviewed files: **exit 0**.
- Independent inline `tsx` assertions: **PASS**, including 148 negative stage/gate checks, independent required-stage inventory, sorting, all three splits, synthetic IDs, missing-case denominators, private extension omission, unknown/duplicate stages, malformed hash/count rejection, and fixed error messages. These probes were not persisted as tests.
- Historical missing-module / `REPORT_NOT_IMPLEMENTED` RED execution is parent-supplied context, not independently re-established here.

## Scope and follow-through

The integration must resolve referenced artifacts and validate their hashes and trusted provenance before supplying these records; syntactic hashes and caller-supplied flags are not authenticity evidence. Do not expose this function as a public untrusted adjudication endpoint. No actual cohort, science, credentials, live service, installation, or commits were used. Only this review document was written.

Current worktree HEAD matches its upstream after fetch. The separate local `main` is eight commits behind `origin/main`; it was inspected but not modified. Existing unrelated worktree changes were left untouched.
