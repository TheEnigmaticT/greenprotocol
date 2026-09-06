# Immutable source/graph and independent audits

Status: implemented and exercised with synthetic fixtures using test-first RED/GREEN cycles; no model chemistry-quality claim.

## Public contract (lane integration)

- `lib/local-qualification/source.ts`: `Source`, `Anchor`, `createSource(Uint8Array|string)`, `anchor(source,start,end)` (half-open UTF-8 **byte** offsets), `verifyAnchor`, `normalizeCRLF`, `restoreCRLF`, `partitionSource(source,maxBytes)`, `sourceWindows(source,maxBytes,overlapBytes)`.
- `lib/local-qualification/graph.ts`: `FACT_CATEGORIES`, `FactCategory`, `FactInput {category, anchor, status, derivationIds, value?}`, `Fact` (+ content-addressed `id`), `EdgeInput {fromFactId,toFactId,relation,anchor,status,derivationIds}`, `GraphRevision`, `createGraph(source,facts,edges?,parentRevisionId?)`, `reviseGraph(source,previous,facts,edges?)`. Status is `observed | inferred | unknown`; inferred facts/edges require explicit derivation IDs. An ID is provenance, not proof of scientific correctness.
- `lib/local-qualification/claim-audit.ts`: `Claim {factId,category,anchor,quote}`, `auditClaims(source,graph,claims)` is closed-world ID/category/exact-anchor/quote validation. It cannot discover omissions.
- `lib/local-qualification/coverage-audit.ts`: `InventoryCandidate {category,anchor,status,derivationIds,value?}` has **no worker fact ID**. `InventoryReview {sourceId,reviewedSpans,candidates}` is independent full-source inventory input. `auditCoverage(source,graph,review)` validates grounding, computes uncovered byte spans and missing candidates. `coverageComplete` is separate from `scientificInterpretationComplete`; neither claims chemistry quality. A reviewer must actually inspect source: this module validates the review, it does not simulate a model reviewer.

All source byte arrays and returned structures are frozen copies. Hashes use SHA-256. Identical exact facts deduplicate; repeated text at different byte anchors remains distinct. Repair creates a new content-addressed revision with a parent link, never mutates the old graph.

## Execution evidence

### Independent-quality remediation (Q1–Q3)

- Q1: Non-null parent IDs now require a primitive string before the SHA-256 format check. Creation and JSON-deserialized graph validation reject array parents; valid parent/graph identity remains unchanged after caller mutation.
- Q2: Accepted and rejected claim snapshots copy only the five declared anchor fields. Arbitrary nested anchor extensions are dropped, not retained or frozen in the caller. This policy assumes declared claim fields have their TypeScript primitive types; it is not a general unknown-JSON claim parser.
- Q3: Partition/window operations copy and freeze source bytes, validate the local snapshot once, and call a private already-validated anchor builder. Public single-anchor validation remains fail-closed. Edge-ID validation canonicalizes each edge against one fact-ID set rather than reconstructing all facts for every edge.

Observed RED: the scoped command below returned **6 failed / 28 passed** before production fixes: parent coercion; accepted/rejected metadata retention; partition/window full-source validation counts of 129/122; and 136 fact-category reads for a two-fact, 32-edge graph (budget 8).

Observed GREEN after fixes: **34 passed in 2 files**, exit 0. The final partition/window tests count actual full-source decoder calls (including defensive copies), asserting exactly one for both one-byte partitions and maximal overlap. They also verify returned quotes survive caller byte mutation and public validation rejects the subsequently corrupted source. No wall-clock performance thresholds are used.

```text
npm test -- tests/lib/local-qualification/source-graph.test.ts tests/lib/local-qualification/coverage-audit.test.ts
./node_modules/.bin/eslint lib/local-qualification/source.ts lib/local-qualification/graph.ts lib/local-qualification/claim-audit.ts lib/local-qualification/coverage-audit.ts tests/lib/local-qualification/source-graph.test.ts tests/lib/local-qualification/coverage-audit.test.ts
./node_modules/.bin/tsc --noEmit --incremental false
```

All three commands completed successfully after the final test-fixture refinement. A transient test fixture overload typing error was corrected before final verification.

Two independent read-only Codex re-reviews completed against the current files: **SPEC PASS for the narrow contract**, and **QUALITY APPROVE for Q1–Q3** with no blocking findings. Reviewers inspected code/tests; implementation execution above supplies test evidence. The separate `graph-quality-review.md` remains a historical pre-fix finding report; this remediation record supersedes its Q1/Q2 unresolved status without rewriting another lane's review file.

### Remaining acceptance and resource limits

This is not full T1/T2, fully typed chemistry extraction, independent-review job execution, scientific completeness, model parity, or qualification READY. All full-plan gaps in `graph-spec-review.md` remain open. No private corpus, chemistry models, or live chemistry jobs were run.

Q3 removes redundant full-source validation from partition/window loops and fact-per-edge reconstruction; it does not establish production resource safety. Explicit source/fact/edge/window/output ceilings remain integration obligations. High overlap still incurs work proportional to emitted window bytes. Graph and audit grounding still validate source preimages for individual anchors; no general linear-time graph/audit complexity claim is made.
