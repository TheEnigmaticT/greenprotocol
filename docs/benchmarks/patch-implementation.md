# Occurrence patch/scoring substrate

Implemented deterministic draft-only byte-range assembly, never whole-protocol generation. Original text/hash remain immutable. Patch preimage, source/graph identity, complete patch fingerprint, independent applicability and joint selected-set authorization must match. Same-ID mutated replacements or moved occurrences, substring aliases (including adjacent Unicode combining marks), overlaps and mismatched joint approval fail closed. Authorities must be trusted internal audit records, never client-submitted grants.

## Narrow trust boundary

This is an **internal trusted adapter**, not integrated source authorization. `assembleScenario` consumes structurally constructible internal authority records; status strings and hashes alone do not prove an independent audit. `bindScore` checks text/hash/description coherence but trusts supplied scenario identity/source/graph fields and supplied material masses. Caller-created scenarios are not authenticated, and positive stale masses are not detected. Only trusted assembled scenarios and trusted input construction may feed it.

The scoring adapter snapshots and freezes its declared input structures and binds output to the supplied scenario identity, input hash and scorer version. Supplied null conversion returns unavailable without invoking the scorer, including after a prior successful score. The injected test callback proves plumbing, not use of the real scientific scorer. Graph-derived material completeness, conversion provenance, real scorer integration and route authorization remain pending. No model, real protocol, SOP application, scientific compatibility or improvement claim.

## SPEC blocker regression evidence

Executed in this worktree:

```sh
./node_modules/.bin/vitest run tests/lib/local-qualification/patch-scoring.test.ts
```

- RED: **2 failed / 5 passed**. Exact, independently authorized UTF-8 fixtures with a combining mark before or after `acetone` unexpectedly assembled instead of throwing `patch_substring`.
- Minimal fix: add Unicode category `M` to both explicit token-continuation guards.
- GREEN: **7 passed** immediately after the fix.
- Expanded invariant suite: **53 passed / 1 file**. Added successful distinct nonoverlapping edits with identical text/identity in every patch/authority array ordering; reversed authorized ID ordering; differing valid joint hashes; missing/extra/duplicate selected IDs; duplicate matching authorities; partial/containing/equal overlaps in both orders; duplicate patch IDs on disjoint occurrences; actual interior two-byte character cuts; invalid offsets and source/graph/authority hashes; every declared patch fingerprint field; same-ID movement to a second valid occurrence; frozen scenario/IDs/input/materials/records/output; caller mutation isolation; independently calculated scorer input hash; and explicit zero-call null-conversion checks.
- No further production behavior change was needed for these added invariant tests. Array-order identity is stable in the tested cases; arbitrary object-property serialization order is not claimed canonical.

```sh
./node_modules/.bin/eslint lib/local-qualification/patch.ts tests/lib/local-qualification/patch-scoring.test.ts
```

Targeted ESLint exited **0**. `git diff --check` exited **0** (owned implementation/test files are currently untracked, so that command alone does not validate their content).

Broader local qualification check:

```sh
./node_modules/.bin/vitest run tests/lib/local-qualification
```

Observed **224 passed / 18 failed**, **5 files passed / 2 failed**. Failures were outside this worker's owned scope: `contracts.test.ts` (4 durable decision-reason failures) and `evidence.test.ts` (14 audit-reference, assessment-completeness and trusted-policy failures). These files were not modified here; concurrent workers own them. This is not a claim that the broader suite is green.

Independent SPEC re-review is pending; the prior rejected review remains unchanged. Only `lib/local-qualification/patch.ts`, `tests/lib/local-qualification/patch-scoring.test.ts` and this document were modified. Fetch succeeded: working branch matched `origin/main`; separate local `main` was eight commits behind and left untouched. The workspace-referenced dev protocol file was absent; no external API code was introduced. No installs, commits, pushes, models or private-source access.
