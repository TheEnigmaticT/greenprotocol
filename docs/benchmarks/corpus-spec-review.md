# Independent corpus SPEC review

## Verdict

**PASS — narrow, offline corpus-loading substrate only.** No blocking contradiction with the specified loader contract was found in the reviewed implementation. This is **not whole-mission acceptance**, not certification of a frozen or complete historical corpus, and not permission to access previously denied inputs. This independent specification review does not substitute for the separate independent security/operational approval required before a real loader run.

Reviewed: `lib/local-qualification/corpus.ts`, `tests/lib/local-qualification/corpus.test.ts`, and `docs/benchmarks/corpus-discovery.md`; also checked repository ignore rules, test configuration, package test command, and references to the loader. No original/private artifact was accessed, copied, enumerated, or loaded. No denied access was retried; no test-root modification or alternate private-access path was introduced. No models, credentials, installs, commits, or pushes were used.

## Specification checks

| Requirement | Finding |
| --- | --- |
| Fixed, ignored, module-derived root | PASS. `corpus.ts:7–10` derives one repository-local root from module location, not cwd, environment, arguments, or a caller root. `.gitignore:64` ignores `/tmp/`; a filename-only `git check-ignore --no-index` confirmed coverage without probing an actual private file. |
| Offline, read-only, no production/service-role imports | PASS. Imports are Node built-ins only; filesystem access uses `lstat` and read-only descriptor operations (`corpus.ts:1–5,60–99`). No inference, provider, production database, credential, or write path appears in this module. Reference search found only the module and its synthetic tests. |
| Explicit reviewed artifact and source allowlists | PASS. Approval must be exactly true; manifests require bounded nonempty artifact/source lists, restrictive filenames, SHA-256 syntax, unique entries, and consistent split annotations (`44–58`). Validated primitives are copied before the first await (`107–110`). Artifact hashes and exhaustive per-artifact source membership are checked (`96,116–133`). The boolean is an assertion, not proof of independent approval. |
| Bounded and checked filesystem reads | PASS by inspection. Symlink components, hardlinked/nonregular files, incorrect private ownership, and group/other access to designated private directories/files are rejected. Descriptor identity, bounded allocation/read, and post-read identity/metadata checks are present (`60–98`). Limits include artifact bytes, manifest artifacts, cases, and protocol bytes. This is not protection against a malicious same-identity process; ancestor validation is not an atomic directory-descriptor traversal. |
| Strict UTF-8 and exact-source deduplication | PASS. Artifact bytes are hashed before fatal UTF-8 decoding; unpaired protocol surrogates are rejected. Source identity hashes the exact UTF-8 protocol string without whitespace/newline normalization (`96–97,119–121`). A single map yields one case per exact hash across artifacts; raw and duplicate counts remain separate (`111–141`). LF and CRLF remain distinct. |
| Preserve historical split semantics | PASS within the reviewed manifest's authority. `calibration`, `previous-holdout`, and `unclassified` are retained; conflicting source annotations are rejected. Nothing promotes previously tuned inputs or previous holdouts to unseen evaluation. Historical classification correctness still requires independent provenance review, not inference from filenames or counts. |
| Keep private content out of reports/errors | PASS within module scope. Returned cases are expressly private execution inputs. They contain protocol text and source hash, but discard private IDs, outputs, quotes, evidence keys, and arbitrary nested fields. The separately constructed safe summary contains counts only. No logging occurs; exceptions are replaced with fixed codes, without filesystem paths, raw input, or nested causes (`131–146`). Callers must never serialize the private case array. |

## Integration limitation — not an evidence-ready cohort

`CorpusCase` returns **protocol text plus identity, split, and counts**, not eligibility candidate objects or approved evidence excerpts. The loader checks that eligibility is an array but does not validate each candidate's meaning. Evidence quote/context strings are structurally checked, then discarded. It neither establishes evidence applicability nor exposes frozen evidence for downstream execution.

Duplicates retain the first occurrence's counts. Exact protocol identity therefore does not establish agreement between repeated records' evidence, eligibility, or baselines. This behavior is documented and acceptable for the narrow deduplicating substrate, but must not silently become the evidence selection policy for a later benchmark.

A follow-on, separately reviewed integration must establish approved candidate/evidence provenance and deterministically resolve duplicate-record differences without leaking private content. Baseline/result-artifact support and a complete spend extractor are also outside this loader. Do not claim this interface alone supplies the execution-ready mission corpus.

## Honest historical cohort and spend reporting

The discovery report correctly leaves historical artifact/source totals, duplicate counts, calibration/previous-holdout membership, frozen evidence availability, baseline availability, and cumulative historical spend **UNKNOWN / unverified because access was denied**. Unknown is not zero. The requested historical Qwen exact model IDs remain **UNKNOWN**; no substitute IDs or fresh provider availability claims were verified here.

A selected approved manifest can establish only that selection's counts, not exhaustive historical coverage. The report does not claim the corpus is frozen. Its warnings that failed/billed requests, retries, separately routed audits, and missing dollar costs can escape a successful-stage ledger are material limitations; this review did not independently inspect historical records or reconcile billing. The $100 cumulative cap cannot be certified from the available evidence. Paid work remains blocked while prior spend is unknown.

## Verification and remaining gates

- Independently executed the existing synthetic-only test command: `npm test -- tests/lib/local-qualification/corpus.test.ts` — **1 test file passed; 22/22 tests passed**. Existing test isolation mocks module location into newly created synthetic temporary directories; it did not access original inputs and was not changed by this review.
- Reviewed test coverage includes approval, filename restrictions, digest/source rejection, permission checks, symlinks, duplicate handling, split conflict, sanitized JSON failure, manifest snapshotting, surrogate rejection, newline distinction, and unsupported schema.
- Coverage limitation: the suite does not directly exercise every inspected guard, notably hardlinks, owner mismatch, byte/count limits, malformed UTF-8 byte sequences, cross-artifact deduplication, and filesystem mutation races. Passing 22 tests is not comprehensive adversarial assurance or a whole-repository green result.
- Fetch succeeded; this worktree's current branch matches its upstream. The separate local `main` is behind `origin/main`; no branch reconciliation or unrelated concurrent edits were attempted.
- Before any actual load: obtain independent security/operational approval of the exact snapshot and manifest, verify historical classification provenance, and separately resolve the access denial with authorization. This report does not clear that denial or populate the review gate.

Only `docs/benchmarks/corpus-spec-review.md` was authored by this reviewer. Production code and tests were not modified.
