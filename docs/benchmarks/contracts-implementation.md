# Local qualification contracts implementation

## S1/S2/S3 revision — verified execution ledger

- Preflight `git fetch`, branch/upstream and main/remote comparison: current branch 0/0; other-worktree main 0/8, left untouched.
- Baseline `npm test -- tests/lib/local-qualification/contracts.test.ts tests/lib/local-qualification/evidence.test.ts`: **77 passed** (127 ms).
- Added tests before production changes. Same command with `--reporter=dot`: **18 failed, 78 passed, 96 total** (146 ms), observed behavioral RED for missing reasons/reference, incomplete pair coverage and ignored policy classification. Duplicate rejection already passed; no new RED claim for existing behavior.
- GREEN, same targeted command: **96 passed, 2 files passed** (146 ms), retaining the original 77 tests.
- First typecheck found four owned typing issues (one callback annotation and three assignments to readonly fixture bindings); corrected without changing behavior or assertions.
- Final `./node_modules/.bin/tsc --noEmit --incremental false --pretty false && ./node_modules/.bin/eslint lib/local-qualification/principles.ts lib/local-qualification/decisions.ts lib/local-qualification/evidence.ts tests/lib/local-qualification/contracts.test.ts tests/lib/local-qualification/evidence.test.ts && git diff --check`: **exit 0**, no output.
- Final `npm test -- --reporter=dot`: **479 passed, 39 files passed**, 17.94 s. Existing mocked pipeline/service tests emit diagnostic output; this is not real model execution.

### Revision behavior and integration boundary

**S1:** Decision schema is now explicitly `2.0.0`; reason payloads and audit references are `1.0.0`. Unavailable, contradicted, rejected and focused P4 human-design reasons survive serialization. Default reasons are explicitly `unspecified`, not fabricated explanations. Historical orthogonal states remain preservable; absent audits remain null and do not authorize anything. Present references must match the decision's candidate, packet, source, graph, principle, claim IDs, evidence IDs and reasons. Deep copies/freezing prevent later caller mutation. Legacy schema `1.0.0` serialized decisions require explicit migration; the parser does not silently reinterpret them.

An audit reference contains the reviewer ID/role, worker ID, principle contract/classification, requested audit verdict, actual gate outcome and reasons, plus SHA-256 audit/context/assessment commitments. `auditHash` addresses `{ audit, contextCommitment }` using the module's canonical JSON SHA-256 convention (sorted object keys, array order preserved). `contextCommitment` contains authenticated actor/role, source/graph, trusted policy, registered claim IDs and evidence ID/recordHash pairs—never evidence excerpts. The integration must persist that immutable artifact and its referenced candidate/packet before persisting the reference, and authenticate retrieval. **No external immutable store, authentication system or semantic reviewer was implemented or exercised.** Hashes are not signatures. Invalid identity/binding/policy input returns reasons with a null audit reference rather than inventing trusted review provenance.

**S2:** The exact relation is every `(packet record ID, record claim ID)` pair. Packet locking rejects any claim outside the candidate. Each pair must occur exactly once in assessments with its record's support kind and `applicable: true`; all four support categories remain independently required for each candidate claim. Regression tests include redundant same-kind evidence, multi-claim evidence, out-of-candidate registered claims and duplicate assessments, plus a fully covered positive control.

**S3:** Candidate hashes now include principle, contract version and change classification. Trusted `AuditContext.policy` independently binds those fields to the exact candidate hash. Missing, stale or disagreeing policy fails closed. Contract draft allowlists permit only bounded substitutions; P4/P10 permit no draft substitution. Molecular, route, product and process-safety redesign cannot obtain draft authority despite a worker's draft label. Tests exercise P4/P8/P10/P12 design classification and trusted-policy mismatches. Real classification must originate from integration-owned review, never copied from worker/source strings. All twelve contracts still honestly report no implemented chemistry worker, and `mayApply` remains false.

Ready for independent specification review after passing verification. The original independent review artifact was intentionally left unchanged. Only the five owned TypeScript/test files and this report were modified in this revision.

## Prior implementation report (historical results; superseded where noted above)

## Delivered

Deterministic substrate only. No model calls, chemistry certification, real principle workers, commits, pushes, deployments, dependency installation, or original-worktree edits.

Owned new files:
- `lib/local-qualification/principles.ts`
- `lib/local-qualification/decisions.ts`
- `lib/local-qualification/evidence.ts`
- `tests/lib/local-qualification/contracts.test.ts`
- `tests/lib/local-qualification/evidence.test.ts`
- This report.

Preflight: fetched origin; isolated branch HEAD `30f252000a86ade611e688291d40eec399edf541` equals origin/main. Local main is behind and belongs to another worktree; untouched. Existing unrelated dirty files belong to parallel work. Read repository CLAUDE.md, lessons.md and TDD skill. The referenced Obsidian dev protocol is absent on this machine; no external API work was needed.

## Contracts and durable state

The immutable registry is exactly P1–P12, each version `1.0.0`, with eligible categories, required graph dependencies, scoped questions, evidence requirements and output restrictions. Every contract explicitly reports `contract-implemented-job-not-implemented`. Eligibility is pending when dependencies exist, not an evaluated result. Missing dependencies are not-evaluated; unknown categories are out-of-scope.

Scopes cover mass/waste/repeated flows; structure/stoichiometry rather than yield; hazard versus exposure and compatibility; target-function/product-specific design; solvent occurrence/mixture/phase/downstream constraints; temperature/time/pressure/apparatus rather than measured energy; documented feedstock origin; protection/activation human route design; catalyst role/loading rather than metal identity; product environmental fate; in-process monitoring versus post-run characterization; and interaction/scale/equipment safety design.

Decision evaluation, finding, authority and lifecycle are independent versioned fields. Tests roundtrip the complete Cartesian product. Storage deliberately preserves historical combinations rather than silently rewriting authority or lifecycle. Storage is NOT authorization. Defaults are not-evaluated/unavailable/no-edit/unselected. Empty, partial, errored, duplicate or mixed-source/graph summaries cannot report all-twelve evaluated/no-issue; `safetyCertified` is always false.

## Evidence and applicability trust boundary

Evidence records are cloned and deeply frozen, SHA-256 content-addressed and versioned, with exact nonempty excerpts verified against immutable snapshot hashes and UTF-16 locators. Contradictions and limitations remain explicit untrusted data. Original hazard, alternative hazard, compatibility and outcome are separate support kinds.

Candidate, source, graph, conditions and evidence packet hashes bind the independent audit. Known claims and evidence must match trusted catalogs. The gate rejects worker self-approval, role/actor spoofing, stale hashes, fabricated IDs, tampering, wrong subjects/conditions, hazard-only efficacy, missing per-claim support, candidate-only/contradicted/unavailable findings, non-evaluated states and human-design-only proposals. Any unresolved contradiction or limitation blocks approval. Approval permits only a draft edit, never application (`mayApply: false`). The module contains no logging.

**Integration obligations:** `AuditContext` must originate from authenticated server-side identity and registered catalogs, never worker/source/evidence text. Hashes are not signatures. Exact quotation verification does not establish semantic chemical applicability: an independent reviewer must actually assess it. This conservative gate currently requires all four support kinds for every substitution claim; it is not a universal chemistry reasoning engine. Source/graph adapters and actual worker execution belong to separate workstreams. Durable state does not itself authenticate edit authority.

## Executed TDD evidence

1. Wrote contracts tests before implementation. First run identified absent modules (one import-failed suite, no tests). Added behaviorless export skeletons, then reran `npm test -- tests/lib/local-qualification/contracts.test.ts`: **21 failed, 3 passed, 24 total**. Missing registry/state behavior and explicit not-implemented functions were the red failures. Three tests passed against the skeleton because empty collection loops or generic throwing assertions were vacuous; these are not represented as independently demonstrated red tests.
2. Implemented contracts/decisions, then the same command: **24 passed**.
3. Wrote evidence tests, added behaviorless skeleton, then `npm test -- tests/lib/local-qualification/evidence.test.ts --reporter=dot`: **53 failed, 53 total**, with missing hash/evidence/audit behavior.
4. Implemented evidence. `npm test -- tests/lib/local-qualification/contracts.test.ts tests/lib/local-qualification/evidence.test.ts`: **77 passed, 2 files passed**, duration 125 ms.
5. `./node_modules/.bin/eslint lib/local-qualification/principles.ts lib/local-qualification/decisions.ts lib/local-qualification/evidence.ts tests/lib/local-qualification/contracts.test.ts tests/lib/local-qualification/evidence.test.ts && git diff --check`: **exit 0**, no output.
6. `./node_modules/.bin/tsc --noEmit --incremental false --pretty false`: **exit 2**, only parallel-owned errors: five BigInt-target errors in `lib/local-qualification/provider.ts`, and two mock tuple/body errors in `tests/lib/local-qualification/provider-manifests.test.ts`. No diagnostics in owned files. This is not a claim of whole-repository typecheck success.
7. `npm test -- --reporter=dot`: **388 passed, 5 failed, 393 total; 37 files passed, 2 failed**. Four failures were parallel-owned `patch-scoring.test.ts` against not-implemented patch functions; one was parallel-owned `source-graph.test.ts` swapped-edge-content-ID validation. Whole-repository execution took 17.93 s. Existing tests emit mocked pipeline/service diagnostic output; owned tests are deterministic and make no provider requests. Other agents may subsequently change these results.

No fixes were made outside owned paths. A final optional Python command to count combinations/status was blocked by the single-query execution policy; no configuration workaround was attempted and no computed combination total is claimed.

## Reusable workflow

For future integrations: write tests before behavior, use behaviorless exports to distinguish import failure from behavioral RED, independently test fail-closed authorization and provenance, run owned tests plus lint/typecheck, then report whole-suite failures by owner rather than editing parallel paths. Avoid empty-enumeration tests that pass vacuously during RED. Preserve separate claims of contract implementation, worker execution, semantic applicability review and safety certification.
