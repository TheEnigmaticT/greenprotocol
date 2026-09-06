# Occurrence/scoring unit — independent quality/security review

## Verdict: APPROVED — narrow trusted internal unit

No blocking quality, logic, or security issue found within the spec-reapproved scope. This verdict covers `lib/local-qualification/patch.ts`, `tests/lib/local-qualification/patch-scoring.test.ts`, and the claims in `patch-implementation.md`, with `patch-spec-rereview.md` as the approved scope. It is not approval for application exposure or scientific use.

## Independently verified

- `./node_modules/.bin/vitest run tests/lib/local-qualification/patch-scoring.test.ts`: **53 tests passed, 1 file passed, exit 0**.
- `./node_modules/.bin/eslint lib/local-qualification/patch.ts tests/lib/local-qualification/patch-scoring.test.ts`: **exit 0**, no diagnostics.
- Additional in-memory `tsx` assertions: **10 checks passed, exit 0**. Covered empty/whitespace/unchanged/newline/lone-surrogate replacements, suppression of a synthetic private marker in a thrown scorer exception, no scorer invocation for NaN/infinite/negative supplied masses, and `applied: false`. No persistent test or implementation files were changed.
- Reviewed the complete target files directly: implementation and tests are untracked, so an empty `git diff` is not evidence of no changes. No baseline checkout, stash, or reversal of concurrent work was performed. Broader suites, application authorization, type-check/build, and real scoring were not independently verified here.

## Findings by invariant

| Area | Review finding |
| --- | --- |
| Occurrence and authority binding | `patch.ts:25–26,38–50` fingerprints every declared patch field, including exact location and replacement. The single matching decision/patch authority must match that fingerprint, source, graph, approved draft status, audit status, evidence-hash syntax, and joint selected set. Same-ID replacement mutation and movement to another valid occurrence cannot reuse the old approval. Hashes bind records; they do not authenticate who issued them. |
| UTF-8 and substring boundaries | `patch.ts:31–45` validates lossless source encoding, safe integer byte spans, exact preimage bytes/hash, and surrounding token continuation using Unicode letters, marks, numbers, underscore and hyphen. Tests include real interior multibyte cuts and combining marks on both sides. Replacement checks reject empty, unchanged, control-bearing and malformed UTF-16 strings. This is the specified syntactic boundary, not comprehensive chemical naming or identity validation. |
| Conflicts and array reorder | `patch.ts:33–35,46–51` sorts copied patches, rejects duplicate IDs/overlap, requires exactly one matching authority and exact selected-ID membership, and requires a shared joint compatibility hash. Tests cover nonoverlapping success, partial/containing/equal overlap, duplicate IDs and authority/set defects across reversal combinations. Caller arrays are not sorted in place. Arbitrary object-property serialization order is not claimed canonical. |
| Immutable snapshots | `patch.ts:59,69–77` freezes the returned scenario and its ID array; scoring copies/freezes the declared input, materials array and scalar-field material records. Tests verify distinct references, failed writes, and isolation from later caller mutation. Output identity binds scenario identity, text hash, serialized input hash and scorer version. This is adequate for the declared plain-data shape, not a deep-freeze or hostile-object boundary for arbitrary additional properties/getters. |
| Scoring availability | `patch.ts:68–78` rejects incoherent description/text hashes, rejects invalid/duplicate material identifiers, withholds scoring for empty materials or null/nonfinite/negative masses, and accepts only finite callback results. The spy-based null-after-success regression proves no scorer invocation or score reuse. The callback is injected plumbing, not proof of the real chemistry scorer. |
| Error privacy and effects | Explicit validation errors are fixed codes; scorer exceptions and nonfinite results become a frozen `scorer_failed` result without exception text. The additional synthetic-marker check confirms no callback error detail leaks in that result. The module has no network, filesystem, credential, logging, database, eval or process-execution path. This is not a promise that arbitrary malformed JavaScript objects cannot throw native errors before the callback boundary. |
| No applied SOP | Assembly changes selected byte slices only, preserves original text/source identity and untouched line endings/occurrences, and always returns `applied: false`. No application/writeback function is present in this unit. A trusted audit can authorize replacement content; this code does not independently establish scientific suitability. |

## Required integration preconditions — not newly solved

1. Authority records must originate from trusted internal audit/approval construction, never client-submitted grants. Status strings and SHA-256 values alone are not authentication.
2. `bindScore` must receive a valid trusted assembled scenario and trusted input construction. A caller-forged scenario with coherent text/hash is **not** authenticated by this adapter; supplied source/graph/identity fields remain trusted. The distinction between a valid source object and a forged scenario is an explicit integration precondition, not a new security claim or a blocker against this narrow spec.
3. Graph-derived material completeness, revised chemical identities, conversion provenance, and positive stale-mass detection remain unimplemented here. Null/nonfinite/negative availability checks do not establish correctness of positive masses.
4. Application authorization, real scorer integration/version provenance, scientific compatibility and improvement, and SOP application remain outside this approval.

## Nonblocking documentation follow-up

`patch-implementation.md:39` still says independent SPEC re-review is pending. `patch-spec-rereview.md` now records PASS. Refresh that historical status when the owning worker next updates the implementation report; no runtime change is required. Its trust-boundary qualifications are otherwise consistent with the reviewed code.

## Repository and ownership

Fetch succeeded. Current working branch matched its upstream `origin/main` (0 ahead / 0 behind); separate local `main` was 8 behind and was left untouched because it belongs to another worktree. Existing unrelated changes were not modified. This reviewer created only `docs/benchmarks/patch-quality-review.md`. No code/test modifications, installs, model calls, private-source/credential reads, commits, pushes, or SOP application were performed.
