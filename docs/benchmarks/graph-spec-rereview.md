# Independent ordered SPEC re-review — graph Q1/Q2/Q3 corrections

## Verdict

**PASS for the narrow generic immutable source/graph and audit substrate, including the specified Q1/Q2/Q3 corrections. Full sprint T1/T2 and qualification READY remain NOT PASS.**

This is a fresh SPEC-only review of the final current files, not adoption of the concurrent Codex SPEC/QUALITY claims in `graph-implementation.md:34`. Those claims do not establish the required ordered gate. A subsequent independent QUALITY review must follow this SPEC result against the same frozen files; this report does not supply that QUALITY approval.

## Scope and independent execution

Read `graph-spec-review.md`, `graph-quality-review.md`, `graph-implementation.md`, all four `lib/local-qualification/{source,graph,claim-audit,coverage-audit}.ts` modules, both corresponding test files, and T1/T2 in `/Users/ct-mac-mini/dev/local-model-migration-planning/sprint-1.md:33–59`.

Executed on the reviewed files:

```text
npm test -- tests/lib/local-qualification/source-graph.test.ts tests/lib/local-qualification/coverage-audit.test.ts
Test Files  2 passed (2)
Tests       34 passed (34)
Duration    153ms
Exit code   0
```

Additional independent read-only `./node_modules/.bin/tsx -e` assertion probes exited 0 with:

```json
{"parentInvalidCases":7,"acceptedRejectedAnchorCopies":true,"bulk":{"partition":{"fullSourceDecodes":1,"spans":256,"detachedDuringValidation":true},"windows":{"fullSourceDecodes":1,"spans":249,"detachedDuringValidation":true}},"edges":64,"factCategoryReads":4,"swappedEdgeIdsRejected":true,"relativeCoverage":true,"scientificStatus":"not-assessed"}
```

Current GREEN is independently established. The implementation's historical six-RED claim was not independently replayed or adopted. No project-wide lint/typecheck claim is made by this review.

## Correction checks

| Requirement | Finding |
|---|---|
| Q1: strict primitive parent ID at runtime | **PASS.** `graph.ts:52–59` requires a primitive string for any non-null parent before checking the exact SHA-256 format. `assertGraph` routes through that check (`62–66`). Persistent regression `source-graph.test.ts:88–105` rejects array/object/number/boolean parents and a rehashed deserialized array parent, preserving valid original identity. Independent probes rejected seven cases at creation and graph validation: array, coercible object, boxed string, number, boolean, plain object and malformed string. Default/null parent remains supported. |
| Q2: declared-field independent anchor copies for accepted and rejected claims | **PASS within the declared typed claim contract.** `claim-audit.ts:18–21` constructs exactly `sourceId`, `start`, `end`, `quote`, `preimageHash`, freezes the new anchor and never spreads undeclared metadata. Both result paths share that snapshot. Persistent tests `coverage-audit.test.ts:25–41` and fresh probes mutate nested extras and the original anchor after return; neither audit changes, extras are absent, and caller metadata remains unfrozen. |
| Q3: one bulk source validation and private validated anchor builder | **PASS for the specified redundant-work correction.** `source.ts:86–92` freezes a detached byte copy before one `assertSource`; partition/window loops use the private `anchorValidated` (`52–56`, `99–126`). Public `anchor` still calls `assertSource` (`48–50`). Persistent tests count actual full-source decoder calls for one-byte partitions and maximal overlap. Fresh probes additionally mutate caller bytes during the full-source decoder invocation: both builders still produce original quotes from their local copies, validate the complete source exactly once, and subsequent public verification rejects the corrupted caller source. |
| Q3: per-edge ID validation without fact rebuilding per edge | **PASS.** `graph.ts:46–50,62–66` canonicalizes each checked edge against one set of canonical fact IDs; no `createGraph` occurs in the per-edge check. The initial graph rebuild remains once per assertion. Persistent category-read budget and swapped-ID regressions pass. Fresh probe with one fact and 64 distinct edges reads the fact category four times total and rejects swapped edge IDs. |
| Preserve audit separation and generic schema boundary | **PASS.** Closed claims remain bound to existing IDs/category/anchor/quote; coverage validates separately supplied candidates and spans, rejects worker-ID-bearing inventory, and always reports scientific interpretation `false` / `not-assessed` (`coverage-audit.ts:25–46`). Fresh probe deliberately inventories only `water` in `water wash` while declaring all bytes reviewed: representational coverage is true relative to that supplied inventory, not proof that `wash` was independently discovered. |

## Mandatory limits and still-open requirements

- Q2 is not an arbitrary unknown-JSON parser. Declared claim and anchor fields are assumed to have their TypeScript primitive types, including for rejected snapshots. The allowlist removes undeclared nested references; it does not promise safe deep-copying of objects maliciously placed in declared primitive fields. The implementation explicitly documents this boundary. Consumers need a separate runtime parser before accepting arbitrary JSON.
- Q3 does not establish production resource safety or general linear complexity. High overlap still performs work proportional to emitted bytes. Individual graph/audit anchors still validate source preimages. Source/fact/edge/window/output ceilings remain integration obligations.
- All full-plan gaps from `graph-spec-review.md` remain open: typed literal/normalized quantities and units, confidence, material identity, mixture basis, operation order, flow/coreference semantics, per-field unknowns and derivation registry are not provided by this generic schema. Unsupported chemistry fields are not authenticated or preserved.
- Explicit ledger/window mapping and semantic extraction/reconciliation acceptance cases, including multi-vessel and organic-layer references, are not established.
- No independent all-source reviewer job execution, disagreement ledger, bounded repair/dispute lifecycle, rerun of both audits or unresolved-on-exhaustion orchestration is established by these functions.
- Full T2 acceptance fixtures and separate omission-recall/claim-precision reporting remain incomplete; the persistent omissions still include `mL` rather than the specified temperature-unit omission and treat monitoring as an observation rather than a monitoring-operation omission. Synthetic matching is not model recall or chemistry-fact validation.
- No models, private corpus, credentials, live chemistry services/jobs, installs, commits or pushes were used. Only this review document was written.

## Frozen-file evidence and repository state

SHA-256 values were identical immediately before the scoped tests and after the independent probes:

```text
8c7984194b3a4ed56749603490145f865a93fb82bf24753e15e6c76b38b89877  lib/local-qualification/source.ts
43fba7353f93fbde189d7378f623e294e8818b67da39f1025d6f9ec0ec11c78e  lib/local-qualification/graph.ts
04d8db175427b856c550d4c88a822854f59d32f67eae94dad40d174da1d9295f  lib/local-qualification/claim-audit.ts
6635f9e9c8f0d9d42468ac1439be4ebfabe826eb294603d46813ae2b8d4ffbe8  lib/local-qualification/coverage-audit.ts
733ebd24006daaee4b599a5c97b2c78025043c8650de10a38a26e21e8464dc84  tests/lib/local-qualification/source-graph.test.ts
1c3278743a328b7fb51ea32c481b315341dc799b70d7e0c3956a346d61a261dd  tests/lib/local-qualification/coverage-audit.test.ts
```

`git fetch --all --prune` succeeded. Active branch `research/local-model-e2e-20260905` at `30f2520` matched its upstream (`0 0`). Local `main`, checked out in another worktree, was eight commits behind `origin/main`; it was not modified. Existing dirty/untracked work was preserved. No blocker was found for this narrow SPEC approval; ordered QUALITY approval remains a separate next gate.
