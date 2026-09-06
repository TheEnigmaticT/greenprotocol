# Independent specification re-review: S1 / S2 / S3

## Verdict

**PASS for the narrow deterministic contracts / durable-reference / applicability-gate substrate.** The corrections satisfy the prior S1, S2 and S3 requirements within the explicitly documented trusted-caller boundary. No new blocking binding hole was found in the reviewed implementation.

This is **not** acceptance of an integrated evidence-audit service, immutable audit storage, graph adapters, authenticated policy construction, working P1–P12 jobs, semantic chemistry review, chemical safety, model performance, or end-to-end qualification. Those remain unimplemented or unexercised here.

## Independent scope and verification

Read the previous `contracts-spec-review.md`, the revised implementation report, all of `lib/local-qualification/{principles,decisions,evidence}.ts`, and both corresponding contract/evidence test files. Read repository instructions and lessons. Only this re-review artifact was written; implementation, tests and the previous review were left unchanged.

Preflight `git fetch` succeeded. Current branch/upstream comparison was `0/0`; local `main` versus `origin/main` was `0/8`. Local main belongs to another worktree and was not modified. Existing dirty/untracked parallel work was preserved.

Executed independently against this worktree:

```text
npm test -- tests/lib/local-qualification/contracts.test.ts tests/lib/local-qualification/evidence.test.ts
Test Files  2 passed (2)
Tests       96 passed (96)
Duration    130ms
Exit        0

./node_modules/.bin/tsc --noEmit --incremental false --pretty false && ./node_modules/.bin/eslint lib/local-qualification/principles.ts lib/local-qualification/decisions.ts lib/local-qualification/evidence.ts tests/lib/local-qualification/contracts.test.ts tests/lib/local-qualification/evidence.test.ts
Exit        0; no diagnostics
```

No independent full-suite or patch-scoring execution is claimed. No adversarial probe outside the existing tests, model call, credential/private-data access, installation, commit, push or deployment was performed.

## Finding disposition

### S1 — CLOSED for versioned durable reasons and external immutable-reference representation

`decisions.ts:13–45` now declares decision schema `2.0.0`, versioned bounded reason codes, candidate/packet bindings and a nullable versioned audit reference. The reference retains audit/context/assessment commitments, reviewer identity and role, worker identity, principle/contract/classification, requested reviewer verdict, actual gate outcome, reasons and source/graph/claim/evidence bindings.

`decisions.ts:50–75` validates present-reference agreement with the enclosing decision, reviewer/worker separation, recognized contract/classification and consistency of verdict/reasons/gate outcome. Candidate and packet references must be present together or both null. Serialization clones and deeply freezes the resulting record. Unavailable, contradicted, rejected and focused P4 human-design reasons are exercised in `contracts.test.ts:52–63`; approving and rejecting audit-reference roundtrips and binding/reason mutations are exercised in `evidence.test.ts:40–56`.

`evidence.ts:140–145` builds content-addressed audit/context/assessment references only when candidate/packet/source/graph, identity and trusted-policy bindings match. Audit identity or binding failures do not acquire a trusted reference. The reference omits evidence excerpts.

The previous finding expressly permitted an external immutable artifact rather than embedding all assessments. The new representation satisfies that option; **the artifact itself is not stored by this code**. The caller must persist and authenticate `{ audit, contextCommitment }`, the candidate and the packet, and verify their commitments on retrieval. A deserialized record validates structural cross-bindings, not whether the addressed artifact exists or whether its supplied hashes/identity are authentic. Historical state dimensions remain intentionally orthogonal and are not authorization. These are explicit boundaries, not an assertion that storage or authenticity was implemented.

### S2 — CLOSED: exhaustive, nonduplicated in-scope record/claim review

`evidence.ts:82–88` rejects a packet record containing any claim outside the candidate scope, including a claim that happens to be registered elsewhere. This closes the former scope mismatch at packet locking; the gate also rebuilds the packet on input.

`evidence.ts:125–137` requires exactly one valid assessment for every `(record.id, record.claimID)` pair. Duplicate pairs, unknown/misbound pairs, wrong support kinds and non-true applicability block approval. A separate loop preserves all four distinct support kinds for every candidate claim. Identifier validation excludes `/`, so the pair-key separator does not introduce an identifier-collision shortcut.

`evidence.test.ts:57–86` exercises the old redundant-record counterexample, an additional unassessed claim on a redundant record, the positive fully covered multi-claim control, registered out-of-scope claims and duplicate assessments. The existential-support requirement no longer substitutes for exhaustive packet coverage.

### S3 — CLOSED within trusted-policy input boundary

`evidence.ts:17–20,33–37,76–80` binds principle, contract version and change classification into the candidate hash and declares a separate integration-owned policy bound to that exact candidate. `evidence.ts:111–113` rejects missing, stale or disagreeing policy and checks the trusted classification against the principle's draft allowlist.

`principles.ts:25–26` allows no draft change class for P4/P10 and only bounded substitution for the other contracts. The gate additionally refuses every non-bounded-substitution class. Thus molecular, route, product and process-safety redesign cannot pass merely because a candidate requests draft authority. `evidence.test.ts:88–108` exercises P4/P8/P10/P12 design work requesting draft authority, worker/policy disagreement, stale candidate/principle/contract policy bindings and missing policy.

The correction implements the trusted-policy binding option allowed by the prior review; it does not implement an authoritative classifier. A caller that copies worker assertions into `context.policy` violates the documented trust precondition. Authentication and semantic classification must be supplied independently before an integrated approval claim is warranted. `mayApply` remains unconditionally false.

## Nonblocking test hardening

Some retained negative tests change the candidate and rebuild the audit/packet without refreshing the newly added policy candidate hash (`evidence.test.ts:153–161,180–183,207–214,220–224`). They still pass, but can now fail for stale policy rather than solely for their named original condition. Source inspection confirms the original state/support checks remain present, and other targeted tests exercise exhaustive coverage with refreshed policy. In follow-up, refresh otherwise-valid trusted policy in these fixtures and assert the intended reason code, so removing an original guard cannot be masked by the unrelated policy failure.

The current reference roundtrip fixture deliberately leaves the decision's state fields at defaults; an explicit approved-draft historical state with a present approving reference, plus auditor-approve/gate-deny reference persistence, would further strengthen regression coverage. This does not block the reviewed representation: state Cartesian roundtrips and reference validation are independently exercised.

## Acceptance boundary

The original S1/S2/S3 blockers are resolved for this generic unit substrate. Existing all-twelve registry scope, honest job-not-implemented status, orthogonal state preservation, fail-closed missing evidence, independent supplied-identity checks and draft-only/no-automatic-application behavior remain intact. Future integration must add actual immutable persistence and verified retrieval, trusted actor/catalog/classification construction, graph/source adapters and substantive independent evidence review before broader completion or chemistry claims.
