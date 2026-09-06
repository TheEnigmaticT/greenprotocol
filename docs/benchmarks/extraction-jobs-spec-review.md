# Independent SPEC review: concrete extraction/inventory adapters

## Verdict

**PASS for the scoped concrete adapter/structural recovery contract; NOT an unconditional pass for semantic extraction completeness or source-supported flow.** The adapters are real role-specific prompt, parser, source-graph and audit integration, not arbitrary JSON pass-through. The recovered provider-pin and request-freezing tests are green. Two substantive semantic assurance gaps and one coverage limitation remain below. No actual model is qualified by these results.

Scope: `lib/local-qualification/extraction-jobs.ts`, its scoped tests, integration documentation, and directly used source/graph/audit contracts. No production certification, code changes, installs, credentials, live inference, or commits. Only this review document was changed by this reviewer. All probes used synthetic injected transports.

## Verified execution

- `./node_modules/.bin/vitest run tests/lib/local-qualification/extraction-jobs.test.ts`: **46 passed / 46**, one test file passed.
- Scoped ESLint on adapter and test: exit 0.
- Scoped strict TypeScript (`--noEmit --skipLibCheck --strict --target es2022 --module esnext --moduleResolution bundler --esModuleInterop`) on adapter and test: exit 0.
- Three additional read-only `tsx -e` synthetic probes exercised the actual exported adapters and audits; observed results are recorded below. They were not added to the frozen source/test files.

Reviewed SHA-256 snapshots:

```text
91055430936c717da13c2f2515c5e25ea17756bb99b7d3933a27511dee31e3fc  lib/local-qualification/extraction-jobs.ts
341ecd5cd7428a1de8ffa92b25cefa734b70dd513fe0d8379c71a57acbc8140c  tests/lib/local-qualification/extraction-jobs.test.ts
ba961d1282d641738e0074ee838af9b11b5e2bbd229f420baf69c997a611579a  docs/benchmarks/extraction-jobs-implementation.md
```

## Findings requiring a bounded qualification gate

### 1. Flow labels are structurally checked, not independently source-supported (high if downstream treats observed edges as verified flow)

**Location:** extraction-jobs.ts:168–194, 265–271; claim-audit.ts:24–36; coverage-audit.ts:29–45.

An edge requires compatible categories, distinct endpoints, a containing exact quote, and no dependency cycle. None of those establishes that its relation or direction is stated by the source. Claim auditing creates claims only for facts; inventory cannot emit edges and coverage compares candidates, not links. Consequently neither audit detects a fabricated or reversed acyclic relation.

Executed probe: source `Stir. Filter.`, two correctly anchored observed operation candidates, and an observed `next-step` edge **Filter → Stir** anchored to the whole source. Independent inventory contained the two correct operation candidates. Actual result:

```json
{"case":"reverse observed next-step","acceptedEdges":1,"claimsValid":true,"coverageComplete":true}
```

This does not mean the adapter itself invents links: the prompt expressly forbids unsupported edges. It means returned `observed` flow remains a model assertion, even when both audits pass. To satisfy a stronger no-invented-flow acceptance criterion, add a separate source-supported relation check/qualification gate or carry an explicit relation-assessment limitation that downstream gates honor. Do not implement a simplistic source-offset ordering rule: genuine prose can state retrospective dependencies.

### 2. Cross-window unknown preservation is instruction-only, not an output invariant (medium)

**Location:** extraction-jobs.ts:198–201, 238–250; source.ts:94–108; implementation documentation:75.

Windows are disjoint byte-bounded partitions, without sentence/operation-aware boundaries, overlap, or reconciliation. The prompt requests unresolved cross-window references, but aggregation does not require a marker for split candidates or unresolved flow. The documentation's statement that cross-window dependencies “remain unresolved” is stronger than the runtime guarantees; the runtime prevents cross-window edges but does not ensure the lost dependency becomes explicit unknown data.

Executed probe: `Stir. Filter.` with `maxSourceBytes: 6`; each request returned its exact window as an observed operation and no edges. Both roles accepted it. Actual result:

```json
{"case":"split operations no unresolved marker","windows":3,"quotes":["Stir. ",".","Filter"],"edges":0,"coverageComplete":true,"unresolvedFactIds":0}
```

The quoted array is graph order, not source order. This also demonstrates that category semantics are not checked: punctuation can be accepted as an observed operation. Explicitly document cross-window semantic completeness as missing, and gate multi-window scientific consumption accordingly. A later solution can use conservative boundary uncertainty markers or separate reconciliation; this review does not prescribe a broad redesign.

## Coverage limitation, not a new promise of universal omission detection

### 3. Per-byte disposition is a review ledger, not proof each byte's procedural content was extracted

**Location:** extraction-jobs.ts:149–167; coverage-audit.ts:33–45.

Every byte must belong to a disposition and every candidate must belong to a containing disposition. The converse is not checked: an entire paragraph can be a facts disposition with one tiny candidate. If inventory independently shares the same omission, coverage passes. The existing omission test correctly proves detection when inventory identifies the missing candidate; it does not prove detection of common-mode omissions.

Executed probe: both roles returned only `Stir.` from `Stir. Filter.`, while assigning the entire source to one facts disposition containing that candidate. Actual result:

```json
{"case":"Filter omitted inside facts disposition","claimsValid":true,"coverageComplete":true,"missingCandidates":0,"unresolvedFactIds":0}
```

This is compatible with the documented separation of coverage and scientific interpretation, so it should not be represented as a regression in quote auditing. Nevertheless, do not describe the byte ledger as semantic no-discard assurance. Likewise a nonempty non-procedural reason is syntactic justification, not validated classification. Broader fixture qualification must challenge both common omissions and unsupported classifications.

## Requirement mapping

| Requirement | Scoped assessment |
| --- | --- |
| Concrete extraction and independent inventory | Pass: exported callable adapters; separate system role text and closed role schemas; actual decoding into source graph / InventoryReview. |
| Inventory receives no worker graph, IDs, claims, outputs | Pass by API/request construction: only source, manifest and transport inputs; declared manifest fields selected; inventory output excludes edges and IDs. Independence is architectural, not proof an injected transport/model cannot share state. |
| Strict JSON shape; no silently discarded malformed candidates | Pass for declared wire schema: exact keys, dense arrays, safe integer offsets, exact quotes, enum constraints, explicit status/value rules, duplicate rejection, no catch-and-continue decoding. Not a universal JavaScript object serialization certification. |
| Source hashes, literal values, no normalization | Pass: source snapshot and UTF-8 hydration; observed value must equal exact anchor quote; unknown must be null; derivations are empty and inferred status is forbidden. No chemical conversion or identity-normalization function is introduced. |
| Content-grounded slots rather than arbitrary JSON | Pass at literal/category schema level: finite categories, anchored string values and typed relations. Category correctness itself is not validated; see punctuation-operation probe. |
| Quantities, mixtures/basis, repeated washes, monitoring, dependencies | Prompt coverage present. Graph categories/relations can express these as anchored candidates and links. No mandatory quantity/unit/count/basis subslots exist, and fixture verification is incomplete. Existing positive fixture retains `wash 3 × 2 mL` as a single operation literal and `TLC` as an observation, not separate wash-count/amount/monitoring-link validation. No comprehensive mixture/component/basis positive case is exercised. Do not certify those semantics from 46 green tests. |
| Per-byte disposition | Structural pass: ordered contiguous full-window partition, candidate accounting, explicit unknown/unclassified support, reasoned non-procedural spans. Semantic caveat above. |
| Separate claim and coverage audits | Pass: all extracted facts are quote-checked; independent inventory can reveal missing candidates; scientific interpretation remains not-assessed. Relations are outside both semantic audits. |
| Manifest/source snapshots; frozen request/schema/result | Pass by implementation inspection and regression execution. Nested objects are recursively frozen; source bytes are copied before transport. |
| Explicit provider pin and role evidence | Pass: optional caller pin preserved literally in manifest/request/tuple; absent pin is not defaulted. sourceHash, role and contractHash supplied; contract binds instructions and output schema. Actual provider routing is outside this adapter-only review. |
| Returned identities match; no fallback | Pass: exact model, tupleHash and attempt match required; injected errors propagate; no adapter retry or fallback. Response contract has no returned provider slug, so actual provider-pin attestation belongs to provider evidence, not this adapter. |
| Bounded windows | Pass for byte bounds and all-window prompt preflight. Cross-window semantic completeness is explicitly missing; see finding 2. |

## Recommended parent disposition

Accept the two-test recovery and concrete adapter integration as verified. Keep model/semantic qualification pending. Before stronger claims, add adversarial relation and cross-window acceptance cases, and representative source fixtures for mixture components/basis, repeated wash count plus each amount, and monitoring/dependency links. Do not substitute a generic JSON success score or both audit booleans for those checks.

Environment notes: git fetch succeeded; current review branch tracks origin/main at HEAD `30f2520`. Local main is eight commits behind origin/main and checked out elsewhere; it was not changed. Required dev protocol path is absent. Existing unrelated dirty/untracked work was preserved. No full suite was run by this review, so the implementation document's broader-suite observations are not independently reconfirmed here.
