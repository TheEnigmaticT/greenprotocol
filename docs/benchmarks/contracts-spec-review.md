# Independent specification review: twelve contracts, decisions, evidence gate

## Verdict

**CHANGES REQUIRED for complete specification acceptance. PASS only for the exercised, narrow deterministic unit behavior—not for the full requested durable-decision/evidence-audit substrate.**

The registry is substantively scoped to exactly P1–P12, state dimensions remain orthogonal, and the gate implements meaningful fail-closed checks. However, durable decisions cannot retain reasons or audit context, and the gate does not require an applicability assessment for every evidence/claim pair in its locked packet. Principle-specific human-design restrictions also are not independently enforced by this generic gate.

No chemistry-quality, chemical safety, working-principle-job, evidence-retrieval, authenticated-auditor, or end-to-end implementation claim follows from this review.

## Scope and real verification

Read in full:
- `lib/local-qualification/principles.ts`
- `lib/local-qualification/decisions.ts`
- `lib/local-qualification/evidence.ts`
- `tests/lib/local-qualification/contracts.test.ts`
- `tests/lib/local-qualification/evidence.test.ts`
- `docs/benchmarks/contracts-implementation.md`

Executed independently:

```text
npm test -- tests/lib/local-qualification/contracts.test.ts tests/lib/local-qualification/evidence.test.ts
Test Files  2 passed (2)
Tests       77 passed (77)
Duration    123ms
Exit        0
```

The findings below are source-level specification analysis; no additional adversarial probe was executed, and these passing tests are not represented as covering the counterexamples below. No inline `-c`/`-e` probes, model calls, private-data access, credential inspection, installs, code changes, commits, or pushes were performed. Only this review artifact was written.

Preflight `git fetch` succeeded. The current research branch equals `origin/main`; local `main` is behind its remote and belongs to another worktree, so it was left untouched. Existing dirty/untracked parallel work was left untouched. Repository instructions and lessons were read. Whole-repository tests, typecheck, and lint were not rerun in this independent review; the implementation report's wider results remain attributed to that report.

## Blocking omissions

### S1 — Durable decisions omit reasons and audit context

**Location:** `decisions.ts:7–30,33–41`; `evidence.ts:23–34,86–89,129`.

`DurableDecision` persists identifiers, source/graph bindings, and the four state dimensions only. It has no reason codes, rationale reference, candidate/packet hash, audit identifier or immutable audit reference, reviewer identity/context reference, assessments, or verdict record. The strict key allowlist rejects any attempt to attach such fields. `AuditResult` returns reason codes and candidate/packet hashes separately, but there is no supported durable link from that result to the decision. It also omits auditor identity and assessment details.

**Consequence:** A rejected, unavailable, contradictory, or human-design decision can survive as a label while its explanation and the context authorizing or denying a draft cannot survive through the provided decision serializer. An `approved-draft-edit` historical record cannot identify which immutable packet and independent audit authorized it. The statement “storage is not authorization” is correct, but does not satisfy reason/audit-context persistence.

**Required acceptance:** Add a versioned durable reason representation and an immutable audit reference or bounded audit envelope, linked to candidate, packet, source, and graph. Persist enough authenticated-review context to reconstruct the verdict without embedding credentials or unnecessarily duplicating private excerpts. Test serialization of unavailable/contradictory/rejected/human-design reasons and approved/rejected audit links; reject inconsistent bindings. An external immutable audit store is a valid design, but its durable identifier and binding still must be represented and tested.

### S2 — Audit coverage is existential per support kind, not exhaustive over packet evidence claims

**Location:** `evidence.ts:109–125`; `evidence.test.ts:127–130`.

The record loop validates catalog membership, status, contradictions, limitations, subject, and conditions. The assessment loop validates only assessments that were supplied. The final loop requires **some** assessed record for each candidate claim and each support kind. It never requires each packet record/claim pair to receive an applicability assessment.

**Source-level counterexample:** Extend an otherwise passing fixture with a second verified compatibility record for `claim-1`, include it in the candidate evidence IDs and trusted catalog, rebuild the packet and audit hashes, and leave assessments covering only the original four records. Every current gate condition can still pass: the additional record satisfies structural checks, while the original compatibility record satisfies the existential support check. The additional evidence has not received the independent applicability assessment required for all packet evidence claims.

There is also a related mismatch: a record may contain a registered claim outside `candidate.claimIDs` (`:111` permits it), but an assessment of that claim is rejected (`:122`). Such packet evidence claims can remain unassessed rather than being explicitly excluded or rejected at packet construction.

**Required acceptance:** Define the exact in-scope evidence/claim relation and require complete, nonduplicated assessment coverage. Either reject packet record claims outside the candidate scope or explicitly project/bind their in-scope claims before locking the packet. Keep the existing requirement for all four distinct support kinds per candidate claim. Add negative tests for an extra unassessed record, a record with another unassessed claim, and an out-of-candidate registered claim. Retain duplicate-assessment rejection.

## Additional enforcement boundary to close before integrated acceptance

### S3 — Human-design restrictions are honored when labeled, not derived from trusted principle/change classification

**Location:** `principles.ts:29,33,35,37`; `evidence.ts:16–19,32–33,74,104`; `evidence.test.ts:132–135`.

P4/P8/P10/P12 contracts explicitly restrict molecular/route/process-safety redesign. The generic `Candidate` carries no principle ID, contract version, or trusted change classification. `AuditContext` contains no maximum authorized edit class or registered candidate classification. The gate blocks `requestedAuthority: 'requires-human-design'`, but accepts the eligibility label `requestedAuthority: 'approved-draft-edit'` when the remaining generic substitution checks pass. It cannot distinguish a prohibited redesign from a permissible bounded substitution.

**Consequence:** The existing test proves that a proposal already labeled human-design is denied. It does not prove that a worker cannot mislabel human-design work as a supported draft proposal. Authenticated auditor identity is not itself a machine-checked principle restriction.

For a deliberately generic pure validator this can be an explicit integration precondition, not an allegation of missing authentication inside the helper. Before claiming the requested principle-aware substrate is complete, either bind a trusted principle/contract/change classification into the candidate and audit policy, or provide and test an authoritative upstream classifier that cannot be populated from worker/source strings. Add a negative test where design-only work requests draft authority despite its trusted classification. The implementation report should distinguish label-based refusal from enforcement of every principle's design restrictions.

## Requirements that are substantively met within the declared unit boundary

| Requirement | Assessment and evidence |
|---|---|
| Exactly P1–P12, explicit dependencies/questions/evidence/restrictions | PASS. `principles.ts:2–37` defines an immutable registry with versioned, nonempty, principle-specific contracts; tests check exact keys and scope terms. Manual reading supports substantive scope, rather than relying only on keywords. |
| Honest worker status | PASS. Every entry states `contract-implemented-job-not-implemented`; dependency availability yields pending, not evaluated. |
| Chemistry-specific boundaries | PASS at contract level. P1 retains mass boundaries and repeated flows; P2 rejects yield proxies; P3 separates hazard/exposure/compatibility; P4 ties product design to target function and human design; P5 scopes solvent occurrences and phases; P6 avoids temperature-as-energy claims; P7 requires origin evidence; P8 restricts route redesign; P9 distinguishes catalytic role/loading from metal identity; P10 concerns product fate; P11 distinguishes in-process monitoring from post-run characterization; P12 requires interaction/scale/equipment safety review. These are declarative contracts, not working evaluators. |
| Orthogonal evaluation/finding/authority/lifecycle state | PASS for the state fields. All declared dimensions are independently validated and serialized, including candidate-only, contradicted, unavailable, rejected, and human-design states. Full Cartesian-state roundtrip is exercised using P3. P4 is a valid registry/decision principle, but a focused P4 human-design roundtrip would strengthen regression coverage. Reason/audit persistence remains S1. |
| Empty/partial cannot become all-twelve no-issue | PASS. Completeness requires exactly one record per principle, common source/graph bindings, evaluated state, and no-issue findings. `safetyCertified` is always false. This is a coverage summary, not proof of chemistry correctness or actual worker execution. |
| Snapshot/record/packet integrity | PASS within trusted catalog assumptions. Snapshot content hash, source ID/version, exact nonempty excerpt, and UTF-16 locator are checked; record/packet hashes bind cloned deeply frozen data. Hashes prove consistency, not source authenticity. |
| Independent audit identity and binding | PASS for supplied trusted context. Auditor must match the context actor and role, differ from worker ID, and reference the candidate, graph, and packet. Candidate hash includes conditions and source/graph bindings. Trusted registered claims/evidence are checked. This does not authenticate arbitrary caller-constructed context. |
| Hazard/alternative/compatibility/outcome separation | PASS for minimum per-claim support. All four support kinds are required; original hazard and alternative-side evidence use the corresponding subject and matching conditions. Exhaustive assessment of every packet claim is missing under S2. |
| Conservative authority filtering | PASS for declared states. Only evaluated/supported/requested-draft candidates can pass. Candidate-only, contradicted, unavailable, unresolved, insufficient, rejected, no-issue, non-evaluated, and human-design-labeled candidates are blocked. Unresolved limitations/contradictions and unverified/unavailable records block approval. S3 bounds this conclusion. |
| No automatic application | PASS. `mayApply` is always false; approval is draft-only. |
| Untrusted text and privacy | PASS within reviewed functions. Evidence strings are data, not executed instructions; the module does not log them and gate failures return reason codes instead of excerpts. This is not a claim about unreviewed integrations. |

## Follow-on work, not completion claims

Actual P1–P12 workers, real evidence retrieval and source-snapshot storage, graph/source adapters, authenticated integration-owned actor/catalog construction, and semantic applicability review are not implemented by these files. Their absence is honestly documented and is follow-on work, not a reason to invent chemistry results. Any future approval path must establish those trusted inputs independently of worker/source text. Recomputed hashes alone cannot authenticate evidence or reviewer authority.

Resolve S1 and S2 before full substrate acceptance; resolve or explicitly enforce and test S3 at the integration boundary before claiming principle-level draft authorization. Preserve the narrow unit PASS and the distinction between deterministic infrastructure, executed scientific work, and chemical-quality/safety claims.
