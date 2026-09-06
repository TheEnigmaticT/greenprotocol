# Independent QUALITY review: discovery diagnostic-only delta

## Verdict: PASS

No blocking security, correctness, or test-isolation defect found in this narrow delta. This supplements the original discovery QUALITY review and the lead diagnostic SPEC PASS; it does not re-review or broaden the original utility's authorization. Only the parent may perform the separately authorized metadata-only retry under the existing approval and quiescence constraints.

## Findings

- `scripts/benchmarks/discover-local-corpus.ts:13–19` selects output from four static literals using exact string equality on an `Error` message. Unknown errors and non-Error values select the static `DISCOVERY_FAILED` fallback. It does not print the arbitrary message, stack, cause, paths, or source text. Prefix matches, appended newlines, trailing whitespace, and nested causes cannot select a recognized diagnostic.
- The catch preserves exit code 1. Discovery must return before the existing success serialization runs; thrown discovery errors produce no partial summary. The exact single-argument review gate is unchanged.
- The 13 added cases exercise the real CLI module with the discovery dependency replaced by a throwing mock, not a live approved discovery call. They assert the exact single stderr write, empty stdout, exit code 1, and exactly one mocked call with `true`.
- Diagnostic cases restore argv, exit code, output spies, dependency mocks, and module cache in `finally`; tests are not concurrent. The existing fixture cleanup also resets filesystem mocks and removes only its unique synthetic sandbox. The original review's host-ancestor-topology caveat for older synthetic utility fixtures remains unchanged; the new diagnostic cases do not invoke filesystem discovery.
- No new credential, model, network, shell, root-selection, or filesystem-access behavior is introduced by the catch. Utility fingerprint is identical to the original reviewed implementation, preserving traversal limits and fail-closed checks.

## Independently executed verification

- `./node_modules/.bin/vitest run tests/lib/local-qualification/discovery.test.ts`: **1 file, 32 tests passed**, exit 0.
- Scoped ESLint on CLI and discovery tests: exit 0, no diagnostics.
- `git diff --check`: exit 0.
- SHA-256 obtained with `shasum -a 256`:

```text
99546164ec2e837f71b6337b7f473b7264289b31eda7fb27399798ab5302e9a4  scripts/benchmarks/discover-local-corpus.ts
071ba7151323ed05395ebe44d2de9c7f29a1d05145b06c09746c98fc81634e00  tests/lib/local-qualification/discovery.test.ts
26579f4c9611afe93b0931fe802d1e1dd704b9d789d1865fcd71be3050d283b6  lib/local-qualification/discovery.ts
```

The implementation note reports an unrelated broader-suite stage-store failure; this narrow reviewer did not rerun that suite or establish a clean project-wide baseline.

## Boundaries and handoff

Fetched origin; current branch matches its upstream (0 ahead / 0 behind). Separate main remains 8 commits behind origin/main and was not modified. Existing shared-worktree changes were left untouched. Created only this report; no code edits, installs, commits, credentials, model calls, private payload reads, or actual approved CLI invocation.

The prior live `DISCOVERY_FAILED` remains **unclassified**. This PASS approves the fingerprinted diagnostic delta, not a claim that private access will succeed or that the prior error was a permission denial. The parent can now obtain a fixed diagnostic through its separately authorized metadata-only retry. Stop on failure and retain the existing roots and checks; do not infer an underlying OS cause beyond what the fixed class establishes.
