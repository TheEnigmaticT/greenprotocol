# Independent SPEC review — source/graph and audit substrate

## Verdict

**PASS for the narrow, synthetic-tested source/graph and audit substrate. NOT PASS for complete sprint T1/T2 acceptance or qualification READY.**

The implementation preserves and anchors raw UTF-8, creates immutable content-addressed graph snapshots, separates closed claim validation from independently supplied source inventory, and never reports scientific interpretation complete. No blocking discrepancy was found against that narrow public contract. The full plan asks for richer runtime-validated chemistry fields, dependency semantics, inventory orchestration and acceptance fixtures that these files do not implement or establish. Those remain blocking if this lane is represented as completing all of T1/T2.

This is an independent spec review, not implementation or scientific adjudication. No live models, private corpus, production services, commits or pushes were used. Only this review file was written.

## Scope and evidence

Reviewed all of:

- `lib/local-qualification/{source,graph,claim-audit,coverage-audit}.ts`
- `tests/lib/local-qualification/{source-graph,coverage-audit}.test.ts`
- `docs/benchmarks/graph-implementation.md`
- External specification: `/Users/ct-mac-mini/dev/local-model-migration-planning/sprint-1.md`, particularly T1/T2, lines 33–59.

Independent execution:

```text
npm test -- tests/lib/local-qualification/source-graph.test.ts tests/lib/local-qualification/coverage-audit.test.ts
Test Files  2 passed (2)
Tests       28 passed (28)
Exit code   0
```

Additional read-only `./node_modules/.bin/tsx -e` probes exercised runtime boundaries and omitted temperature-unit/whole-span cases; results are recorded below. No test files were added. This review establishes current GREEN, not historical RED-first discipline, project-wide lint/typecheck, or model recall.

Repository discovery: `git fetch` succeeded; active branch was equal to its upstream (`0 0`). Local `main`, checked out in another worktree, was behind `origin/main` by eight commits; it was not modified. Existing dirty/untracked work was left intact. The supplied Obsidian dev-protocol path was unavailable; no API work was performed.

## Requirements checked

| Requirement | Finding and evidence |
|---|---|
| Immutable raw UTF-8 and exact raw hash | PASS. `source.ts:29–43` uses fatal decoding, preserves BOM, rejects lone-surrogate string conversion, copies input bytes and freezes source/byte arrays. Hash identity changes with CRLF versus LF. Tests include mutated input buffers and invalid encodings. |
| Canonical byte offsets and exact source/quote preimage | PASS. `source.ts:48–58` enforces nonempty half-open integer byte ranges at UTF-8 code-point boundaries and verifies source ID, quote and range preimage hash. These are not JavaScript character offsets. |
| Reversible CRLF derived view | PASS with explicit contract. `source.ts:60–80` retains raw identity, derives normalized bytes and both maps, and marks the collapsed CR/LF interior `null`. Restoration validates the derived object against the retained original source and returns the original bytes; it is not standalone recovery from normalized text alone. |
| Full-byte ledger and bounded windows | PASS for the primitives. `source.ts:82–119` partitions all bytes, including whitespace, and separately produces bounded source-anchored windows. UTF-8 budgets that cannot contain/progress across a code point fail explicitly. Windows do not carry explicit ledger-entry references; see full-plan gap below. |
| Fact vocabulary and knowledge provenance | PASS as a generic substrate. `graph.ts:3–22,31–41` includes all ten requested categories, explicit observed/inferred/unknown states, verified anchors, string values and derivation-ID arrays. Inference requires a nonempty array of nonblank strings. A derivation ID is not a resolved derivation record or evidence of scientific correctness. |
| Immutable graph identity, exact dedupe and repeated occurrences | PASS. `graph.ts:36–58,66–69` hashes canonical fact/edge content, deduplicates identical IDs, sorts snapshots and creates parent-linked replacements without mutating old snapshots. Different byte occurrences and categories remain separate. Derivation IDs are canonicalized as a set. |
| Runtime validation rather than TypeScript declarations alone | PASS within declared fields. `assertGraph` reconstructs graph content, checks graph and individual fact/edge IDs, verifies source identity, endpoints, categories, status, anchors and provenance. Tests reject swapped deserialized edge IDs; additional probes reject forged fact IDs and modified values. This is not a full chemistry schema validator. |
| Closed claim audit | PASS. `claim-audit.ts:21–34` requires an existing fact ID plus exact category, source anchor and quote agreement. Unknown IDs and mismatches reject; empty claims do not pass. A valid subset remains valid without asserting inventory completeness. |
| Independent all-source omission substrate | PASS with caller responsibility. `coverage-audit.ts:24–46` accepts source-bound reviewed spans and independently supplied candidates rather than worker claim IDs, rejects `id`/`factId` properties, validates candidates, computes byte gaps and reconciles exact canonical candidate content. It does not generate or attest to the independence/completeness of the review. |
| Empty extraction and unknown scientific meaning | PASS. Empty source, graph or candidate inventory cannot produce `coverageComplete`. Scientific completion is always `false` and status always `not-assessed`. Unknown/unresolved/unclassified graph facts are exposed separately; they do not prevent representational coverage from being true. |

## Seeded omissions and negative execution

The checked-in tests remove anisole, Pd, an entire mixture, quantity `2 g`, volume unit `mL`, `Monitor by TLC`, an unresolved mixture reference, repeated wash, repeated water, and repeated quantity. Each expected omission is detected independently of accepted claims. A whitespace review gap fails coverage; truncated overlapping anchors do not substitute for exact candidates. Repair creates a new revision while the old failed audit remains failed.

Additional synthetic probe source was `water at 25 °C; monitor TLC`:

- An independent `condition` candidate anchored exactly to `°C`, absent from the graph, returned `missingCandidates` quote `["°C"]`.
- Empty `reviewedSpans` returned the entire source as an uncovered span.
- Worker-ID-bearing inventory, numeric fact value, invalid edge status, inferred edge without derivations, forged fact ID, mutated fact value and foreign-source claim anchor all rejected.
- A graph containing only `water`, accompanied by an inventory containing only `water` and a full-source reviewed-span declaration, returned `coverageComplete: true` and scientific status `not-assessed`. This is the intended **relative-to-supplied-inventory** limit, not proof that temperature/monitoring were inventoried.
- Extra runtime fields `confidence` and `normalizedQuantity` were ignored in graph construction: changing them did not change graph identity. They are not supported schema fields and must not be treated as preserved chemistry data.

## Blocking gaps against full sprint T1/T2

1. **Full T1 chemistry contracts are absent, not merely scientifically unvalidated.** T1 line 39 explicitly calls for literal/normalized quantities and units, confidence, occurrence/material identity, mixture basis, operation order, and flow/coreference dependencies. `FactInput` is category + anchor + status + derivation IDs + optional string; `EdgeInput.relation` is an unconstrained nonblank string. There are no typed fields or field-level validators for those chemistry concepts, no per-field unknown representation, and no derivation registry. Anchors distinguish textual occurrences but do not establish shared material identity. The runtime probe confirms unsupported chemistry properties are dropped from content identity. A future caller must not pass richer objects expecting those fields to survive.

2. **Window/ledger and dependency reconciliation remain primitives rather than the full T1 workflow.** Windows and partitions share raw anchors but have no explicit mapping contract between them. Exact duplicate facts reconcile, but no window extraction/reconciliation workflow creates ambiguous-reference links. Organic-layer reuse, multiple vessels, operation order and observations-versus-charged-reagents are not exercised as semantic graph relationships in these tests. Generic edges and an unresolved-reference category enable representation but do not satisfy those acceptance cases by themselves.

3. **Full T2 job/repair/dispute workflow is not established in this scope.** The coverage function compares a caller-supplied inventory; it does not dispatch an independent all-source reviewer, preserve a disagreement ledger, bound repair attempts, rerun both audits after repair, or enforce unresolved-on-exhaustion. The repair test reruns coverage only. Independent reviewer provenance and source completeness must be enforced by orchestration, not inferred from this function's boolean.

4. **Full T2 acceptance evidence is incomplete in the checked-in regression suite.** It seeds `mL`, not the specified temperature unit; monitoring is categorized as `observation`, not an independently omitted monitoring `operation`. The extra probe demonstrates that an omitted temperature-unit candidate and an entirely unreviewed source are detected, but these are not persistent regression tests. A monitoring-operation omission, dependency examples, and separate omission-recall versus claim-precision/rejection reporting remain unverified here. No model-quality metric is justified by synthetic candidate matching.

## Acceptance boundary

The parent may accept this lane as an **immutable generic graph plus closed-claim/independent-inventory comparison substrate, verified by two scoped test files**. Do not label complete T1/T2, fully typed chemistry extraction, independent-review execution, scientific completeness, model parity, or READY on this evidence. Resolve the full-plan gaps or explicitly approve narrower scope before those broader gates are closed.
