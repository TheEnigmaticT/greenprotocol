# Independent ordered QUALITY re-review — frozen graph substrate

## Verdict

**APPROVE / QUALITY PASS for the narrow typed-server immutable source/graph and audit substrate. No concrete blocking quality or security defect found within that contract.**

This independent QUALITY review was performed after reading the fresh narrow SPEC PASS in `graph-spec-rereview.md`. All six reviewed files match that report's SHA-256 values before and after this review's execution. This closes the ordered QUALITY gate for this frozen unit only; it does not adopt earlier concurrent review claims.

**Full scientific/semantic completeness, full sprint T1/T2, downstream workflow completion and qualification READY remain NOT PASS.** Unknown-JSON parsing is explicitly excluded from this approval, as required by the SPEC boundary.

## Scope and findings

Read all four `lib/local-qualification/{source,graph,claim-audit,coverage-audit}.ts` modules, both corresponding tests, the fresh SPEC report and the original quality findings. No source or test was changed.

| Finding | Quality assessment |
|---|---|
| Q1 — primitive parent revision ID | **Resolved.** `graph.ts:52–59` checks the primitive string type before the exact hash pattern and retains only a primitive/null parent. Deserialized validation goes through the same constructor. The persistent array-parent regression and independent seven-case rejection probe pass. This removes the mutable-parent identity defect rather than merely freezing an invalid input. |
| Q2 — detached claim anchors | **Resolved for the declared typed contract.** `claim-audit.ts:18–21` copies exactly the five declared anchor fields, sharing the same snapshot path for accepted and rejected claims. Neither path retains undeclared nested metadata or freezes caller-owned metadata. Persistent tests and independent post-return mutation probes cover both outcomes. |
| Q3 — redundant bulk validation | **Resolved for the requested correction.** `source.ts:86–92` makes and freezes a detached local byte snapshot before validation. Partition/window loops use the private validated builder; the exported single-anchor function still validates its source. Both persistent decode-count regressions pass. `graph.ts:62–66` validates each edge against one canonical fact-ID set, without rebuilding facts per edge. An independent 64-edge probe read the single fact's category four times and rejected rotated edge IDs. |
| Content-address and immutability design | Constructors explicitly build canonical declared content, freeze nested anchors/derivation arrays and outer arrays, and bind revisions to their parent. Exact deduplication does not collapse distinct occurrences/categories. Replacement-snapshot revision semantics are documented. No new mutable alias was found for declared typed fields. |
| Audit separation and interval correctness | Closed claims validate existing IDs/category/exact anchors/quotes; they do not measure omissions. Coverage compares a separately supplied candidate inventory and reviewed spans. An exhaustive synthetic byte-mask probe verified union accounting despite reversed/duplicated spans. Scientific interpretation remains explicitly `not-assessed`. |
| Security surface | Static inspection found no external network/filesystem sink, shell execution, dynamic evaluation, credential access or logging in the four modules. Imports are local modules and Node crypto. Audit outputs deliberately contain source quotations and must remain source-sensitive in downstream storage/logging. |

The implementation is compact and its private/public validation split is understandable. Some long expressions (especially the claim rejection chain and graph assertion) could later be split into named predicates for readability; this is optional, not a reason to change the frozen unit.

## Independent execution evidence

Scoped test command:

```text
npm test -- tests/lib/local-qualification/source-graph.test.ts tests/lib/local-qualification/coverage-audit.test.ts
Test Files  2 passed (2)
Tests       34 passed (34)
Duration    151ms
Exit code   0
```

Scoped installed ESLint command:

```text
./node_modules/.bin/eslint lib/local-qualification/source.ts lib/local-qualification/graph.ts lib/local-qualification/claim-audit.ts lib/local-qualification/coverage-audit.ts tests/lib/local-qualification/source-graph.test.ts tests/lib/local-qualification/coverage-audit.test.ts
No diagnostics; exit code 0.
```

Additional independent read-only assertions executed with the installed `./node_modules/.bin/tsx -e` runner:

```json
{"invalidParentsRejected":7,"acceptedRejectedDetached":true,"coverageCases":1024,"windowCases":156,"factCategoryReads":4,"swappedEdgeIdsRejected":true}
```

Probe details:

- Rejected array, coercible object, boxed string, number, boolean, plain object and empty-string parents.
- Mutated original nested metadata and anchor quotations after accepted/rejected claim audits; serialized returned audits stayed unchanged, extras were absent, and caller metadata stayed unfrozen.
- Enumerated every reviewed-byte mask for the ten-byte synthetic source `water wash`, reversed and duplicated each mask's spans, and checked exact reviewed-byte totals and completeness. Scientific interpretation stayed unassessed.
- Exercised empty, ASCII, CRLF and multibyte sources over byte bounds 4–9 and their valid numeric overlap values. All partitions reconstructed the original text. Successful windows met UTF-8 anchor validity, byte budgets, increasing starts, no gaps and full extent; explicitly impossible UTF-8 overlap configurations were allowed to throw the documented progress error. The 156 count includes those expected rejections, not 156 successful window outputs.
- Constructed 64 distinct edges, measured fact category reads during graph validation, and rejected rotated edge content IDs.

No project-wide typecheck, project-wide test/lint run, historical RED-first replay, production performance benchmark or live scientific execution is claimed.

## Boundaries that remain mandatory

1. This is a **typed-server substrate**, not an arbitrary unknown-JSON parser. Declared primitive fields are assumed to satisfy their TypeScript primitive types; objects smuggled into those fields are outside this review's contract. Consumers need a separate parser before arbitrary external JSON enters these functions. Allowlisted anchor copies resolve Q2 without broadening that contract.
2. Bulk validation improvements do not imply general linear complexity or production resource safety. Overlap still costs work proportional to emitted bytes, and individual graph/audit anchors still validate whole-source preimages. Source/fact/edge/window/output ceilings remain integration obligations.
3. Coverage is relative to the supplied independent inventory and declared reviewed spans. These functions do not execute an independent reviewer or establish that all meaningful source facts were discovered.
4. All full-plan gaps in the fresh SPEC report remain open: typed scientific quantities/units, confidence, material identity, mixture basis, order/flow/coreference semantics, per-field unknowns, derivation registry, ledger/window mappings, semantic acceptance fixtures and separate omission-recall/claim-precision reporting. Unsupported scientific fields are not authenticated or preserved by the generic schema.
5. Independent review-job orchestration, disagreement ledger, bounded repair/dispute lifecycle, rerunning both audits and unresolved-on-exhaustion enforcement remain downstream obligations. This approval does not complete T1/T2 or READY.

## Frozen-file evidence and repository hygiene

SHA-256 values matched the fresh SPEC report before testing and after the independent probes:

```text
8c7984194b3a4ed56749603490145f865a93fb82bf24753e15e6c76b38b89877  lib/local-qualification/source.ts
43fba7353f93fbde189d7378f623e294e8818b67da39f1025d6f9ec0ec11c78e  lib/local-qualification/graph.ts
04d8db175427b856c550d4c88a822854f59d32f67eae94dad40d174da1d9295f  lib/local-qualification/claim-audit.ts
6635f9e9c8f0d9d42468ac1439be4ebfabe826eb294603d46813ae2b8d4ffbe8  lib/local-qualification/coverage-audit.ts
733ebd24006daaee4b599a5c97b2c78025043c8650de10a38a26e21e8464dc84  tests/lib/local-qualification/source-graph.test.ts
1c3278743a328b7fb51ea32c481b315341dc799b70d7e0c3956a346d61a261dd  tests/lib/local-qualification/coverage-audit.test.ts
```

`git fetch --all --prune` succeeded. Active branch `research/local-model-e2e-20260905` matched its upstream (`0 0`). Local `main`, checked out in another worktree, remained eight commits behind `origin/main`; it was not modified. Existing dirty/untracked work was preserved. No live application service, credentials, private corpus, model, install, commit or push was used. The only authored file is this report, `docs/benchmarks/graph-quality-rereview.md`.
