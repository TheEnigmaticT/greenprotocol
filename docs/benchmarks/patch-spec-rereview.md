# Occurrence patch / scenario scoring — independent SPEC re-review

## Verdict: PASS — narrow trusted internal substrate only

The combining-mark blocker and the required regression-coverage blockers in `patch-spec-review.md` are resolved. No remaining blocker was found against that narrow spec. This is **not** approval of integrated source authorization, real chemistry scoring, graph-derived material completeness, conversion provenance, or positive stale-mass detection.

## Independently executed verification

```sh
./node_modules/.bin/vitest run tests/lib/local-qualification/patch-scoring.test.ts
```

Result: **1 test file passed; 53 tests passed; exit 0**.

```sh
./node_modules/.bin/eslint lib/local-qualification/patch.ts tests/lib/local-qualification/patch-scoring.test.ts
```

Result: **exit 0**, no diagnostics.

The historical **2 failed / 5 passed RED** and immediate **7 passed GREEN** sequence is documented in `patch-implementation.md`; it was not independently replayed by reverting code. The corrected implementation and both combining-mark regressions were inspected, and the current full narrow suite was independently executed. The broader local-qualification suite was not rerun; its previously reported failures are outside this verdict.

## Resolution of previous blockers

| Required invariant | Evidence inspected | Re-review finding |
| --- | --- | --- |
| Combining-mark substring rejection | `patch.ts:43–44`; `patch-scoring.test.ts:15–20` | Both token-continuation guards now include Unicode category `M`. Fixtures place a combining mark before and after `acetone`, compute exact UTF-8 spans and matching source/patch authority fingerprints, and specifically require `patch_substring`. This closes the original prefix/suffix gap without claiming chemical identity validation. |
| Joint selected set and compatibility | Tests `63–101`; implementation `46–51` | Two distinct, nonoverlapping occurrences have separate patch fingerprints and matching authorities. Success checks exact revised text and complete scenario equality, including identity, across all patch-array/authority-array reversal combinations and reversed authorized-ID order. Negatives independently introduce differing valid joint hashes, missing/extra/duplicate selected IDs, and duplicate matching authority records, requiring `patch_authority` in every tested array ordering. |
| Order-independent conflicts | Tests `103–113`; implementation `33–34` | Partial overlap, containing spans, equal spans, and duplicate IDs on disjoint occurrences each require `patch_conflict` in both patch orders. Partial and containing fixtures use exact textual spans at valid token boundaries rather than merely malformed preimages. The two-edit success case supplies the required nonoverlapping control. |
| UTF-8 and exact identity negatives | Tests `117–154`; implementation `32`, `38–42`, `49–50` | Actual interior cuts in the two-byte alpha character are verified against its byte values and rejected as `patch_preimage`. Negative, empty, reversed, out-of-range, fractional, nonfinite, and unsafe-integer offsets are rejected. Separate cases cover original/source disagreement, malformed top-level source/graph hashes, patch source/graph disagreement, invalid patch/decision IDs, authority source/graph/fingerprint disagreement, malformed evidence/joint hashes, and false preimages. Relevant changed patch fixtures receive freshly computed approvals, avoiding accidental stale-fingerprint rejection in place of the intended earlier check. Interior-code-point fixtures are rejected by exact byte/preimage validation; they do not demonstrate independent execution of every later boundary-check branch. |
| Complete patch fingerprint and moved occurrence | Tests `38–40`, `156–170`; implementation `25–26`, `49` | Every declared patch field changes the fingerprint, whose expected field sequence is independently hashed in the test. Changed replacement content cannot reuse the old authority. Moving the same approved ID to the second valid occurrence with identical preimage also fails; a fresh matching authority succeeds at that second occurrence, proving the rejection is approval binding rather than an invalid target. |
| Immutability and score-input binding | Tests `174–212`; implementation `59`, `69–77` | Tests assert frozen scenario, patch-ID array, captured scorer input, materials array, material record, and returned binding. Attempted writes fail; later caller edits to patches, authorities, input description, material mass, and material-array membership leave captured scenario/input/output values unchanged. Snapshot structures are distinct references. Expected `inputHash` is calculated from the original caller input serialization, independently of the returned binding. |
| Null conversion never invokes or reuses scoring | Tests `214–225`; implementation `73` | A successful score is followed by a null conversion using the same caller input. A cleared spy confirms zero subsequent scorer calls, and the frozen unavailable result has the expected input hash and no score property. This is stronger than the old throwing-callback example, whose exception could have been caught by the adapter. |

The scorer-callback freeze assertions cannot silently yield a passing scored result if caught by the adapter: the enclosing test also requires `state: 'scored'` and `score: 9`.

## Trust boundary and exclusions retained

- Authorities remain structurally constructible **trusted internal records**. Hashes and approval strings do not authenticate an independent audit. No client-to-authority or real source-authorization route was reviewed.
- `bindScore` checks text/hash/description coherence but trusts supplied scenario identity/source/graph fields. Acceptance of caller-constructed scenarios is not solved or claimed solved. Its use must remain restricted to trusted assembled scenarios and trusted input construction.
- Supplied positive stale masses are not detected. Material occurrence completeness, revised chemical identity, and conversion provenance are not established by these tests. The null-conversion guarantee is correctly qualified in the updated implementation documentation.
- The injected scorer demonstrates plumbing, immutable input binding, and unavailable handling, not use or correctness of the real chemistry scorer. No scientific compatibility or improvement claim follows.
- Array-order stability is covered for the tested patch and authority records; arbitrary object-property serialization order is not claimed canonical.
- Draft assembly preserves the original, untouched repeated occurrence, and line endings; `applied` remains false. No SOP application or generative whole-protocol rewrite is authorized by this review.

## Scope and repository state

Read the prior SPEC review, corrected implementation, expanded tests, implementation report, and repository instructions/package metadata. Fetch succeeded: the current branch is **0 ahead / 0 behind** its upstream `origin/main`. The separate local `main` reference is **8 behind** and belongs to another worktree; it was not modified. Existing unrelated dirty files were left untouched.

This review writes only `docs/benchmarks/patch-spec-rereview.md`. No implementation/test changes, installs, models, private-source reads, commits, pushes, or external scoring calls were performed.
