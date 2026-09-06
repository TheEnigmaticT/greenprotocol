# Independent contracts / decisions / evidence quality and security review

## Verdict: APPROVED

No blocking quality or security defect found **within the narrow trusted-server-caller deterministic substrate**. This approval covers the corrected principle contracts, durable decision/reference representation, evidence snapshot/packet construction and applicability gate. It does not approve persistence, authentication, scientific review, source/graph integration, workers, automatic application or chemical safety.

## Scope and independently executed verification

Reviewed:
- `lib/local-qualification/principles.ts`
- `lib/local-qualification/decisions.ts`
- `lib/local-qualification/evidence.ts`
- `tests/lib/local-qualification/contracts.test.ts`
- `tests/lib/local-qualification/evidence.test.ts`
- `docs/benchmarks/contracts-implementation.md` and `contracts-spec-rereview.md`
- Repository instructions and lessons.

Preflight `git fetch` succeeded. Current branch versus upstream: `0/0`; local main versus origin/main: `0/8`. Main belongs to another worktree and was left untouched. Existing parallel changes were preserved.

Actual verification in this worktree:

```text
npm test -- tests/lib/local-qualification/contracts.test.ts tests/lib/local-qualification/evidence.test.ts
Test Files  2 passed (2)
Tests       96 passed (96)
Duration    131ms
Exit        0

./node_modules/.bin/tsc --noEmit --incremental false --pretty false
Exit 0; no diagnostics

./node_modules/.bin/eslint lib/local-qualification/principles.ts lib/local-qualification/decisions.ts lib/local-qualification/evidence.ts tests/lib/local-qualification/contracts.test.ts tests/lib/local-qualification/evidence.test.ts
Exit 0; no diagnostics
```

An additional inline `tsx -e` synthetic-data probe completed with **85 independent assertions, PASS, exit 0**. It did not write a test file. It exercised refreshed-policy state/support failures, auditor-approve/gate-deny durable roundtrips, P4/P10 bounded-class denial, audit/context/assessment commitment changes, recursively frozen outputs, post-call mutation isolation and confidential malformed-input handling. No full-suite execution is claimed by this review; the implementation report's wider-suite results were not independently rerun.

## Findings

### 1. Reason and audit bindings — acceptable

`decisions.ts:50–75` validates schema/version, hash and identifier formats, unique identifiers, bounded versioned reasons, paired candidate/packet references and allowed decision/reference fields. A present audit reference must agree with the decision's source, graph, principle, contract, candidate, packet, claim/evidence arrays and reasons. Supplied reviewer/worker identities must be distinct. The stored approval flag must agree with the reviewer verdict and absence of gate reasons.

`evidence.ts:103–119,140–147` rebuilds and verifies the packet, compares candidate/source/graph/audit bindings, validates independent supplied identity and trusted policy, and commits the audit, assessments and trusted context to separate hashes. Identity, binding or policy mismatches cannot acquire a trusted audit reference. The audit hash includes the context commitment; catalog evidence is represented there by ID and record hash, not excerpt text.

The independent probe confirmed that assessment ordering changes assessment/audit hashes and a changed registered-claim catalog changes context/audit hashes. It also verified durable serialization of an approving reviewer verdict that the gate correctly denies for candidate ineligibility. This is an important valid distinction, not an inconsistent result.

Stored references are structural integrity references, not proof that an artifact exists or is authentic. The candidate, packet and `{ audit, contextCommitment }` must be persisted and verified by integration code. Historical state fields are intentionally not used as authorization. Those limitations are documented and are not blockers for this unit.

### 2. Snapshot integrity and immutable outputs — acceptable

`evidence.ts:60–88` checks snapshot bytes against the declared SHA-256 hash, snapshot version and ID, UTF-16 locator bounds and exact excerpt equality. Evidence record hashes commit metadata as well as excerpts. Packet construction validates record hashes, exact evidence membership, uniqueness and candidate-scoped claims. Evidence records and packets are copied before recursive freezing; decisions likewise copy and deeply freeze their nested data.

Candidate objects and supplied audit/context inputs are not promised to be frozen by this API. Their relevant contents are hashed or copied into the synchronous output. The probe verified recursively frozen packet/result contents and that later caller mutation of the audit/context does not alter an already returned result. Existing tests cover source/record tampering and mutation isolation of evidence limitations and decision reasons.

### 3. Exhaustive pair coverage — acceptable

`evidence.ts:125–137` requires each declared record/claim pair to have an assessment, rejects duplicate pairs, rejects extra or misbound assessments and requires exact support kind plus `applicable === true`. A separate per-candidate-claim loop requires all four support kinds. This prevents redundant same-kind evidence from hiding an unreviewed record or claim. Validated identifiers exclude the `/` pair-key separator.

The corrected tests include redundant evidence, multi-claim pair omissions, positive complete coverage, out-of-candidate claims and duplicates. The independent probe also confirmed that hazard-only, uncovered-claim and empty packets fail for missing support with a refreshed, otherwise-valid policy—not merely because of a stale policy hash.

### 4. Classification and draft-only authority — acceptable

`evidence.ts:76–80,110–114` hashes principle, contract version and worker classification, requires an independently supplied policy bound to that exact candidate, and enforces the contract draft allowlist. P4/P10 allow no draft classes; all other contracts permit only bounded substitution. Redesign classes remain human-design-only despite a draft request. The probe additionally verified P4/P10 denial even when both candidate and trusted policy label the proposal bounded substitution.

The integration must independently establish classification, authenticated actor identity and catalog provenance; copying worker assertions into trusted policy violates the API's declared precondition. `mayApply` is always false. The registry honestly labels all chemistry jobs unimplemented.

### 5. Error confidentiality and implementation surface — acceptable

The reviewed unit has no logging, network requests, subprocess execution, dynamic evaluation, database access or raw evidence included in audit results. Evidence/candidate/packet constructors use fixed errors; malformed audit input becomes a fixed reason code and denial. Durable JSON parsing also returns a fixed error rather than echoing its input. The independent malformed-assessment probe confirmed denial and absence of a synthetic private-text sentinel in the result.

Evidence records intentionally contain excerpts; this approval does not make those records safe for logs or public responses. Hashes and validated identifiers returned in references are intentional metadata. Hostile JavaScript getters/proxies, arbitrary executable objects and unbounded public request handling are not an authenticated plain-data integration boundary and were not certified here.

## Nonblocking follow-up: strengthen retained negative tests

**Location:** `tests/lib/local-qualification/evidence.test.ts:153–161,180–183,207–214,220–224`.

Several older tests change the candidate and rebuild packet/audit hashes but retain the prior trusted policy candidate hash. Their boolean-denial assertions can therefore pass for `policy-binding-mismatch` even if the named state/support guard regresses.

**Requested strengthening:** refresh otherwise-valid policy bindings after each candidate change, assert the intended reason (`candidate-not-edit-eligible`, `missing-applicable-support`, or `missing-evidence`), and assert absence of unrelated policy mismatch. Keep a valid positive control. Add the independently exercised auditor-approve/gate-deny durable roundtrip and P4/P10 bounded-class denial as permanent regressions.

This is not a blocker: the actual guards are present, corrected pair/classification tests target their reason codes, and the independent fresh-policy probes verified the intended behavior in this review. The remaining issue is permanent regression-test sensitivity, not a demonstrated authorization bypass.

## Change and acceptance boundary

Only this review artifact was written. No implementation/test edits, private-data or credential access, model calls, installs, commits, pushes or deployments were performed. No blockers remain for this unit's scoped quality/security approval. Immutable artifact storage and verified retrieval, trusted context construction, source/graph adapters, real workers and substantive independent scientific review remain integration obligations—not delivered features.
