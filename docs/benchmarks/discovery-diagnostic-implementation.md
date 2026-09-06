# Discovery CLI diagnostic delta

## Scope and failure

The CLI catch discarded the discovery utility's fixed failure classification and always emitted `DISCOVERY_FAILED`. The prior live scan's underlying class remains unknown; this implementation did not retry it and makes no permission-error inference.

Only the CLI catch and discovery tests were edited, plus this note. The discovery utility, roots, review gate, filesystem checks, traversal limits, and success output were not changed. No formatter export or utility refactor was necessary.

## Output contract

On failure the CLI emits one fixed line on stderr and sets exit code 1, with no summary on stdout. Only an Error with an exact message equal to one of these literals selects that literal:

- `DISCOVERY_UNSAFE_PATH`
- `DISCOVERY_INVALID_JSON`
- `DISCOVERY_LIMIT`
- `DISCOVERY_REVIEW_REQUIRED`

Everything else selects `DISCOVERY_FAILED`. Output is selected from fixed literals, not copied from the exception. No stack, cause, arbitrary message, filesystem path, or source text is emitted. This does not add more granular filesystem diagnoses or change utility error normalization.

## Strict TDD evidence

1. Added CLI import tests with the discovery module mocked to throw. This tests the actual CLI catch without executing discovery or reading private roots. Process argv, output spies, exit code, and module mocks are restored after each case.
2. RED: `./node_modules/.bin/vitest run tests/lib/local-qualification/discovery.test.ts` returned exit 1: **4 failed, 28 passed**. All four failures were expected fixed classes receiving `DISCOVERY_FAILED` instead.
3. Changed only CLI catch classification.
4. GREEN: same focused command returned exit 0: **32 passed**.
5. Focused ESLint and `git diff --check` returned exit 0.

Negative tests cover an arbitrary synthetic private message, a fixed-code prefix with appended newline/path, trailing whitespace, `EACCES`, a wrapped fixed-code cause, a plain object with matching message, a thrown string, null, and undefined. Allowed-code errors also carry a synthetic private cause. Tests require exact stderr, no stdout, one discovery call, and exit 1. Existing synthetic utility safety and invalid-invocation tests pass.

Broader regression command: `./node_modules/.bin/vitest run tests/lib/local-qualification` returned **421 passed, 1 failed** across 14 files. The failure is outside this delta: `stage-store.test.ts` / `syncs both file and directory even for a pre-existing complete artifact` expected at least 2 sync calls, observed 0. It was not modified or repaired under this ownership scope. Because that command used `&&`, its appended lint did not execute; lint was run separately with the passing focused test afterward.

## Review handoff

Independent **SPEC then QUALITY** review of this narrow delta is still required before the parent considers any live retry. This note does not constitute approval. No private scan, private reread, credential access, install, commit, or root change was performed.

Review fingerprints (SHA-256):

- `scripts/benchmarks/discover-local-corpus.ts`: `99546164ec2e837f71b6337b7f473b7264289b31eda7fb27399798ab5302e9a4`
- `tests/lib/local-qualification/discovery.test.ts`: `071ba7151323ed05395ebe44d2de9c7f29a1d05145b06c09746c98fc81634e00`
- Unedited `lib/local-qualification/discovery.ts`: `26579f4c9611afe93b0931fe802d1e1dd704b9d789d1865fcd71be3050d283b6`
