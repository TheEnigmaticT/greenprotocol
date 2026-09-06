# Independent quality/security review — source/graph audit substrate

## Verdict

**CHANGES REQUIRED for the narrow unit: two reproduced immutability/runtime-validation bugs.** The scoped suite passes **28/28 tests**, but does not cover these failures. This review does not overturn the spec review's deliberate scope boundary: **full sprint T1/T2, scientific/semantic completeness, downstream completion and qualification READY remain NOT PASS**.

Scope: `lib/local-qualification/{source,graph,coverage-audit,claim-audit}.ts`, both `source-graph` and `coverage-audit` test files, and the implementation/spec-review documents. Only this quality-review file was written. No models, private corpus, external application services, installs, commits, pushes, source edits or test edits were used.

## Blocking findings

### Q1 — P2: parent revision validation accepts a mutable array, invalidating immutable graph identity

**Location:** `graph.ts:48,57–58,61–64`.

The parent-ID regex coerces its input rather than requiring a string. A JSON-compatible single-element array containing a valid hash passes. `createGraph` embeds the original array without copying/freezing it. The returned graph's parent can therefore change after hashing even though the graph object itself is frozen. `assertGraph` also accepts a JSON-round-tripped graph containing this invalid parent type before mutation: this is a supported deserialization-boundary concern, not just an adversarial getter or prototype trick.

Executed reproduction using the installed `tsx` runner:

```ts
const source = S.createSource('water');
const fact = { category: 'material', anchor: S.anchor(source, 0, 5),
  status: 'observed', derivationIds: [] } as const;
const parent: any = [S.sha256('parent')];
const graph = G.createGraph(source, [fact], [], parent);
G.assertGraph(source, JSON.parse(JSON.stringify(graph)));
parent.push('mutated');
```

Actual probe output (one-fact graph): `acceptedAfterJSON: true`, `parentFrozen: false`, `idUnchanged: true`; `graph.parentRevisionId` contained both the original hash and `"mutated"`.

**Required fix:** explicitly require `typeof parentRevisionId === 'string'` for non-null values before applying the format check. Reject arrays, objects, numbers and other non-string values at creation and deserialized validation. Add regression tests for the JSON-compatible array case and unchanged parent/graph identity after caller input mutation. Do not merely freeze an invalid array type.

### Q2 — P2: accepted claim snapshots preserve mutable arbitrary anchor extensions

**Location:** `claim-audit.ts:18–19,28–34`.

`snapshot` spreads the entire caller anchor and freezes only the outer copied object. `verifyAnchor` checks declared anchor fields but ignores extras. An otherwise valid anchor with an extra nested object is accepted, and the returned audit retains that object by reference. The caller can mutate the already-returned audit's accepted claim through the original input. This contradicts the implementation's documented frozen-copy guarantee. Unlike Q1, ordinary TypeScript structural assignment can carry such extra anchor properties without a cast.

Executed probe attached `{ metadata: { privateMarker: 'synthetic-only' } }` to a valid claim anchor, ran `auditClaims`, then changed the original metadata object. Actual output:

```json
{"probe":"anchor-extra","valid":true,"extra":{"privateMarker":"changed-after-audit"},"extraFrozen":false}
```

This also propagates undeclared caller metadata into audit artifacts unnecessarily. It is **not evidence of external exfiltration**: these modules have no outbound sink, and the marker was synthetic.

**Required fix:** snapshot an explicit allowlist of the five declared anchor fields, or consistently reject unknown anchor properties. If invalid claims must be retained, make their snapshot policy explicit and safe as well. Add accepted/rejected claim tests with nested extras and post-return caller mutation. Freezing the caller's original object would introduce an undesirable side effect; prefer a canonical independent copy.

## Resource-hardening finding

### Q3 — P2 operational concern: bounded windows do not bound total validation work

**Locations:** `source.ts:40–43,48–49,92–119`; additionally `graph.ts:64`.

Partition/window creation calls `anchor` for each output, and every call validates, copies, hashes and decodes the entire source. With `maxBytes = 1` on ASCII, partitioning performs quadratic source-validation work. A high-overlap window configuration similarly produces near-one-byte progress and many whole-source validations. These loops terminate, but can consume excessive CPU on caller-controlled inputs. No input/output-count ceiling is enforced here.

Actual single-run local timings, with no model/network use:

| ASCII source bytes | Partition bound | Returned partitions | Elapsed ms |
|---:|---:|---:|---:|
| 2,000 | 1 | 2,000 | 118 |
| 4,000 | 1 | 4,000 | 450 |
| 8,000 | 1 | 8,000 | 2,605 |

These are diagnostic observations, not a stable performance benchmark. Separately, `assertGraph` reconstructs all facts once per edge when checking edge IDs, multiplying graph-validation work; that path was inspected but not benchmarked.

**Recommendation before untrusted/large-input integration:** validate an immutable local source snapshot once per bulk operation, use a private already-validated anchor builder, validate edges without rebuilding all facts per edge, and enforce explicit source/fact/edge/window budgets at the integration boundary. Keep exported single-anchor validation fail-closed. Add scaling and maximal-overlap tests. Q1/Q2 alone already block approval; this concern additionally prevents claiming resource-safe production readiness.

## Verified strengths and explicit limits

- Raw-byte copies, fatal UTF-8 decoding, BOM preservation, byte-boundary anchors and CRLF maps are covered by the scoped passing tests. Constructors freeze declared graph facts, anchors, derivation arrays, edges and outer arrays; Q1/Q2 identify exceptions at runtime input boundaries.
- Fact and edge IDs are rebuilt from canonical declared content. Existing tests reject swapped deserialized edge IDs. Extra chemistry fields are **not hashed, validated or preserved** by graph construction. An additional probe changed deserialized `facts[0].confidence` from `0.1` to `0.9`; both `assertGraph` calls accepted the same graph ID. This confirms the spec review's unsupported-fields warning, not a complete chemistry schema. Consumers must not interpret accepted unknown fields as authenticated graph content; an eventual parser should return canonical data or reject extras.
- Closed claims bind ID, category, exact anchor and quote; they do not enumerate missing source facts. Coverage compares exact independently supplied candidates and reviewed-byte intervals, not worker claims. Worker-ID-bearing inventory is explicitly rejected. Coverage gap merging is monotonic and handles overlap without double-counting.
- An additional synthetic source containing `water SYNTHETIC_MARKER`, with only `water` inventoried and the whole source declared reviewed, produced `subsetClaimValid: true`, `relativeInventoryComplete: true`, `scientific: "not-assessed"`. This is coverage **relative to caller-supplied inventory**, not proof that every meaningful source item was independently discovered.
- Window loops strictly advance or throw for impossible UTF-8 overlap. An additional ASCII grid exercised **144/144 combinations** across empty/nonempty/CRLF sources and all valid overlap values for bounds 1–8; size, full extent, monotonic progress and no-gap invariants held. Existing tests exercise multibyte boundaries. No infinite loop was found; Q3 concerns finite but excessive work.
- Static review found no network/filesystem calls, shell execution, dynamic evaluation, logging or credentials in the four modules; imports are local modules and Node crypto. Explicit validation errors use fixed text. A synthetic bad quote returned only `Invalid fact anchor`, without echoing the marker. Accepted/rejected audit artifacts intentionally contain source quotes and must still be treated as source-sensitive; no broader logging/privacy policy was tested.

## Verification and environment

Executed successfully:

```text
npm test -- tests/lib/local-qualification/source-graph.test.ts tests/lib/local-qualification/coverage-audit.test.ts
Test Files  2 passed (2)
Tests       28 passed (28)
Duration    152ms
Exit code   0
```

Additional read-only `./node_modules/.bin/tsx -e` probes produced the findings above. A supplemental Unicode-literal probe was blocked by the command security scanner; it did not execute. The subsequent ASCII-only window grid succeeded; the checked-in Unicode tests also passed. No scanner configuration was changed. No project-wide lint/typecheck or historical RED-first verification was performed.

`git fetch` succeeded; the active branch matched its upstream (`0 0`). Local `main`, checked out in another worktree, was eight commits behind `origin/main`; it was not modified. Existing dirty/untracked work was preserved. The supplied Obsidian dev-protocol path was unavailable; this review performed no API coding.

## Full-plan gaps remain open

The parent must preserve every gap in `graph-spec-review.md`, especially:

1. Typed literal/normalized chemistry quantities, units, confidence, material identity, mixture basis, operation order, flow/coreference dependencies, per-field unknowns and a derivation registry are not implemented by this generic schema. Unsupported chemistry properties are ignored.
2. Windows/ledger mapping, extraction/reconciliation, ambiguous-reference semantics and multi-vessel/organic-layer/dependency acceptance cases are not a completed workflow.
3. No independent-review job orchestration, disagreement ledger, bounded repair/dispute lifecycle, rerun of both audits, or unresolved-on-exhaustion enforcement is established here. These are tracked downstream obligations, **not completed work**.
4. Full T2 regression/acceptance evidence, including the specified temperature-unit and monitoring-operation omissions and separate omission-recall versus claim-precision metrics, remains incomplete. Synthetic inventory matching is not model-quality or scientific-completeness evidence.

Re-review Q1/Q2 after fixes and persistent regression tests. Even a later narrow-unit approval must not close full T1/T2 or READY.
