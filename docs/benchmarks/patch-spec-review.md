# Occurrence patch / scenario scoring — independent SPEC review

## Verdict: BLOCKERS before full narrow-spec approval

The existing narrow unit suite passes: **1 file, 5 tests passed**, independently executed with:

```sh
./node_modules/.bin/vitest run tests/lib/local-qualification/patch-scoring.test.ts
```

This verifies the checked-in examples, not every stated invariant. One lexical substring gap and several material verification gaps remain. No production/source-authorized rescore approval is given.

Scope: only `lib/local-qualification/patch.ts`, `tests/lib/local-qualification/patch-scoring.test.ts`, and repository instructions were read. No private corpus, model, credentials, commits, pushes, implementation changes, or SOP application. Historical RED runs and lint cleanliness are parent-provided evidence, not independently reproduced here.

## 1. Implementation blocker: combining marks bypass the substring guard

**Location:** `patch.ts:43–44`.

The guard checks adjacent Unicode letters/numbers, underscores and hyphens, but not Unicode combining marks. A source such as `Add acetone\u0301.` allows the byte span for plain `acetone`, with a matching preimage and matching internal authority, even though the selected text is a prefix of the larger combining-mark-bearing token. The resulting edit retains the trailing accent on the replacement. The suffix begins with category `M`, which the guard does not reject.

**Needed regression:** construct the source above, compute the exact UTF-8 span and all source/patch/authority fingerprints for that fixture, and require `patch_substring`. Exercise a preceding combining-mark boundary too if the chosen lexical policy treats it as token continuation. Extend the guard's explicit token-continuation policy to cover combining marks. This is a code-path finding, not an independently executed new test.

This finding concerns the stated no-substring contract; it does not imply that character-boundary checks establish chemical identity. Actual graph occurrence validation remains a separate integration gate.

## 2. Verification blockers: required invariants have no direct regression

The following should be covered before calling the complete narrow spec verified:

- **Joint selected set / compatibility:** `patch.ts:46–51` implements the checks, but no existing test uses two distinct, valid, non-overlapping patches and independently fingerprinted authorities. Add a successful two-patch case; then reject differing valid `jointCompatibilityHash` values, missing/extra authorized IDs, and duplicate matching authority records. Reverse patch order and authority order and assert the same successful text/identity or the same rejection. The current empty-authorized-list example does not verify joint compatibility.
- **Order-independent conflict rejection:** the overlap test at `patch-scoring.test.ts:36` checks only identical spans in one ordering. Add partial overlap and containing-span fixtures in both orders, duplicate IDs on disjoint occurrences, plus a successful non-overlapping control. Otherwise an implementation that only rejects equal starts could pass the present test.
- **UTF-8 and exact identity negatives:** the current positive multibyte-prefix fixture is useful, but `start + 1` splits the ASCII preimage rather than a multibyte code point. Add a genuine interior-code-point offset, invalid/reversed/out-of-range/noninteger offsets, mismatched original/source hash, patch graph mismatch, and authority source/graph mismatch. Keep unrelated fixture fields valid so each asserted error reaches its intended check.
- **Immutability / scorer input binding:** add assertions that the scenario, patch-ID array, returned binding, scorer input, materials array and material records are frozen; verify later caller mutations cannot change captured scorer inputs or output identities. Capture the injected scorer input and independently calculate its `inputHash`. Assert that null conversion never calls the scorer (a spy/counter), not merely that the result is unavailable. Existing tests do not check `inputHash` or attempted mutation.

The mutated-replacement regression at `patch-scoring.test.ts:32–34` correctly addresses reuse of an approved ID for changed replacement text. Extend it to an alternate valid occurrence with the same preimage, keeping the old authority, to prove occurrence movement also invalidates approval.

## 3. Boundary limitations — do not mislabel as integrated authorization

- `PatchAuthority` is a structurally constructible record, and `assembleScenario` documents authorities as **trusted internal records** (`patch.ts:28`). Status strings and hashes are not proof of an independent audit by themselves. This is acceptable for an internal deterministic substrate only if a later caller obtains these records from the approved internal authority source, never from user grants. No such boundary integration was reviewed.
- `bindScore` checks text/scenario hash and input-description equality (`patch.ts:63`), but trusts `scenario.identity`, `sourceHash`, and `graphHash`. A caller-created/cloned scenario with a changed `identity` is not rejected. Keep this API restricted to trusted assembled scenarios, or add provenance/identity validation before exposing a source-authorized scoring boundary. This is not evidence that a forged scenario passes through any real application route.
- Material occurrence completeness, revised material identity, and mass conversion provenance are not established here. A positive stale mass would still pass the adapter's numeric checks. The tested guarantee is **supplied null conversion yields unavailable**, not detection of all stale quantities. Rename/qualify the test description “never stale quantities” accordingly.
- The injected constant-return callback proves callback plumbing, not use of the real existing scorer. No actual graph-derived material completeness, real scorer integration, or full source-authorized rescore is claimed until graph validation and trusted input construction are integrated and tested.

## What is established by inspection and the passing examples

Exact byte-slice assembly preserves untouched repeated names and line endings; source and preimage hashes are checked; `patchFingerprint` includes all declared patch fields; approval and joint-set checks are present; the returned scenario and patch IDs are frozen; `applied` stays false; no generative rewrite or SOP-writing path exists in this module. Scoring checks scenario-text/description coherence, snapshots and freezes declared input structures, returns unavailable for null conversion, and delegates numeric computation to an injected callback without introducing a chemistry formula.

## Repository state

Fetch succeeded. The reviewed worktree's branch is **0 ahead / 0 behind** its upstream `origin/main`. The separate local `main` reference is **8 behind** `origin/main`; it belongs to another worktree and was not modified. Existing unrelated dirty files were left untouched. This report is the only file created by this review.
