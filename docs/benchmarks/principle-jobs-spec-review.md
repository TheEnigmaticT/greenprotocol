# Independent SPEC review: twelve principle job adapters

## Verdict: FAIL — not approved for live or application integration

Scope: `lib/local-qualification/principle-jobs.ts`, its 52 tests, `PRINCIPLES` in `principles.ts`, the implementation interface document, and supporting graph/evidence/decision boundaries. This is an independent implementation/spec review, not model or chemistry qualification. No live models, private credentials, installs, commits, or application changes were used.

The implementation provides actual bounded request builders, strict output parsing, typed candidates/evidence packets, and a separate applicability request. It is more than a registry. However, a reproduced unresolved-dependency bypass and insufficient principle-specific advisory outputs prevent acceptance as twelve completed, useful concrete jobs.

## Blocking findings

### S1 — Required unresolved facts can be omitted and draft approval obtained

**Severity: high.** `principle-jobs.ts:157–170` checks that returned fact IDs are a subset of the caller's dependency facts, then computes completeness from the worker's selected check statuses. It does not account for omitted required facts or unknown dependency edges. `buildApplicabilityJob` checks the selected evidence/claim pairs and selected assessment facts (`223–244`), but does not independently enforce completeness of the required dependency neighborhood.

A local synthetic probe supplied an observed material fact and an explicitly `unknown` mixture fact, with both registered under P5 `mixture-composition`. The worker selected only the observed fact for its `known` check. Four frozen synthetic evidence records supported the selected claim. An independent reviewer response also selected only that claim. Real execution returned:

```json
{"omittedRequiredUnknownFactAccepted":true,"evaluation":"evaluated","auditApprovedDraftEdit":true,"mayApply":false}
```

This is a structural gate reproduction, not a fabricated model response represented as live evidence. Both worker and reviewer responses were deliberately constructed adversarial fixtures. Authenticated caller identity and approved evidence were accepted as preconditions; neither was forged. The problem is trusting the worker/reviewer to omit no required unknowns despite the adapter already possessing the unresolved dependency.

**Required fix:** derive unresolved dependency coverage independently from the trusted dependency map and graph, including relevant edge states. Refuse supported/no-issue and draft approval while a required unknown is omitted or unresolved, unless an explicit independently owned resolution/out-of-scope mechanism authorizes exclusion. Add an adversarial regression at both worker parsing and applicability approval boundaries. Do not merely add a prompt instruction.

### S2 — No adequate principle-specific analytical/advisory result schema

**Severity: high for the stated useful-job deliverable; not an automatic-edit exploit.** `PrincipleJobResult` (`25–35`), the worker output schema (`141–147`), and result assembly (`198–201`) permit dependency status/ID arrays, a single candidate identity pair, and a fixed action code. The full frozen graph/evidence catalog is copied into `grounding`; this preserves provenance but is not itself an analysis of those records. There is no field for a bounded, anchored interpretation, occurrence-level finding, comparison outcome, limitation explanation, or documented design constraint beyond generic dependency keys.

This is especially limiting for non-substitution P2/P4/P6/P8/P10/P11/P12 advice: a fixed `review-...-human-design` code plus the input catalog does not communicate what the worker found about function, energy boundary, route selectivity, fate, monitoring intervention, or process interaction. The synthetic test claiming retained constraints (`149–159`) asserts equality of copied input facts/evidence, not that any meaningful principle-specific advisory finding is produced.

**Required fix:** introduce bounded typed finding/action structures suited to each principle, linked to existing fact/evidence IDs and preserving unknown/contradiction states. No free-form invented citations, molecules, numeric savings, or executable rewrites are needed. Add realistic differentiated fixtures and assertions that outputs communicate the particular finding and constraint rather than simply returning the catalog. Until then, describe this as bounded adapter infrastructure, not twelve completed useful chemistry jobs.

## Additional findings

- **Audit grounding is discarded:** applicability output requires `factIDs`, but maps each assessment to `{...pair, applicable}` at `241`. The returned/durable audit therefore loses the graph references used to substantiate each assessment. Preserve those references in a versioned auditable artifact or documented companion record; a graph hash alone does not identify which anchors justified approval.
- **Per-principle qualification is absent:** all twelve tests reuse one generic synthetic observed material fact for every dependency and the same non-chemical excerpt for four support kinds (`tests/.../principle-jobs.test.ts:11–31`). They verify wiring, provenance, and malformed-output handling, not distinct chemical interpretations. This is acceptable for scaffolding tests, not evidence of useful/admissible chemistry outputs.
- **Status documentation is stale:** the implementation document says planned/in progress and verification pending (`1–16`), while the implementation now exists and its targeted tests pass. `PRINCIPLES.implementationStatus` still says `contract-implemented-job-not-implemented` (`principles.ts:15,26`). Do not replace this with a qualified/ready state; distinguish adapter implemented, spec blocked, and model qualification not run.
- **Planning-source limitation:** the requested `principle-contracts-and-release-gates` planning artifact was not located by filename/content searches in the review worktree or filename search in the main checkout; worktree `.hermes` and default `~/.hermes/plans` were absent. Matrix below is grounded in the actual `PRINCIPLES` contract plus the delegated requirements. Parent should reconcile any additional planning-only criteria before acceptance.

## Twelve-job contract matrix

All rows share S1's incomplete dependency-coverage enforcement and S2's insufficient analytical output. Distinct scope text exists for every row; the table is not a scientific pass certification.

| Job | Concrete scope and contract represented in request | Restriction represented | Remaining job-specific acceptance evidence |
|---|---|---|---|
| P1 Waste | Occurrence material flows, repeated wash/transfer/recovery/disposal, mass boundary | No volume-to-mass invention or incomplete PMI | Distinct repeated-flow findings and boundary omissions, not just copied facts |
| P2 Atom economy | Verified structures, stoichiometry, target, reaction boundary | Yield is not atom economy; proposals human-design | Balanced/unbalanced transformation interpretation with anchored limitations |
| P3 Synthesis hazards | Original/alternative hazard, exposure, compatibility, outcome | Hazard alone cannot establish risk or substitute efficacy | Explicit compatible/incompatible comparison and exposure findings |
| P4 Product design | Product identity/function, performance and product hazard | No molecule invention; proposals human-design | Function-versus-hazard advisory constraints for documented candidates |
| P5 Solvents | Exact occurrence, mixture ratio/basis, phase and downstream dependencies | No global replacement; rankings candidate-only | Unknown-mixture bypass must fail; distinct occurrence and cross-step findings |
| P6 Energy | Temperature/time/pressure/apparatus, scale and outcome | Temperature is not energy; condition change human-design | Anchored energy-boundary finding and temperature-duration tradeoff limitations |
| P7 Feedstocks | Identity, lot/chain-of-custody origin, fraction and supply boundary | No origin inference from identity; renewable not lower impact | Origin and equivalence finding with lifecycle boundary limitations |
| P8 Derivatives | Route roles and selectivity constraints | Removal/reordering/replacement human-design, no rewrite | Essential-versus-avoidable role interpretation and explicit selectivity constraints |
| P9 Catalysis | Assigned role, loading units/basis, turnover/recovery and outcome | Metal name does not establish catalysis; new routes human design | Stoichiometric-versus-catalytic distinction grounded in actual role/loading facts |
| P10 Degradation | Product compartment, fate timescale and transformation products | No solvent-to-product inference or invented pathways; human-design | Product-fate findings and uncertainty tied to exact compartment/conditions |
| P11 Monitoring | Timing, method, analyte/matrix and intervention linkage | Post-run characterization is not control; human-design | Explicit post-run versus intervention-capable monitoring finding |
| P12 Safety | Interactions, order/rate, heat/gas/pressure, scale/equipment/quench/controls | No missing-hazard safety inference; human-design | Interaction-specific constraints and individually benign but conflicting changes |

## Verified strengths and scope boundaries

- `buildPrincipleJob`, `runPrincipleJob`, and `buildApplicabilityJob` are actual implemented functions.
- Worker requests incorporate each registry's questions, evidence requirements, restrictions, and distinct review scope. Strict output objects reject extra citation/rewrite/score/authority fields.
- Source/graph hashes and fact IDs are verified; frozen evidence excerpts are checked against content-addressed snapshots. Original prefixed hashes are validated before explicit conversion to the decision schema.
- Candidate alternatives must already appear in frozen evidence at the selected conditions hash. No citation retrieval or new subject IDs are provided by model output.
- Worker decisions never grant approved-draft-edit directly; independent reviewer identity differs from the worker. Reviewer payload omits worker finding and requested authority. An applicability gate validates four support kinds per claim, evidence bindings, subject/conditions, and policy.
- Human-only action scopes are set for P2/P4/P6/P8/P10/P11/P12. Advisory and human-design paths do not apply edits. Applicability result has `mayApply: false` even in the reproduced draft-approval bypass.
- `runPrincipleJob` has injected approved-model transport only, no construction of a production client, no retries/fallback, and no raw error logging. Direct imports are local graph/source/principles/decisions/evidence/provider, not the legacy pipeline or legacy prompts. The provider module contains the separately owned explicit network boundary; this is not a claim that the transitive module contains no network code.
- Transport/output failure produces error/unavailable/no-edit. The targeted test verifies twelve transport failures cannot become `allTwelveEvaluatedNoIssue`; summary safety certification remains false.
- Caller approval/catalog authenticity, authenticated auditor context and independently classified policy, budget/deadline transport, audit persistence, and rendering remain explicit integration preconditions, not capabilities certified here.

## Execution evidence

- `git fetch` succeeded. Review HEAD `30f2520` was synchronized with its upstream (`0 0`); local `main` was eight commits behind `origin/main` in another worktree and was not changed. Shared worktree changes were preserved.
- `npm test -- tests/lib/local-qualification/principle-jobs.test.ts`: **1 file passed, 52 tests passed**, exit 0.
- Additional local `tsx -e` adversarial probe: **omitted required unknown accepted; draft approval true; automatic application false**, exit 0.
- No full-suite regression claim is made. Parent-reported unrelated extraction failures were not reclassified as failures of these tests.

## Release disposition

**Keep live calls and application integration blocked.** The infrastructure merits continued isolated development, but passing the existing tests does not close S1/S2, establish twelve useful role outputs, qualify an actual model, or certify chemistry/process safety. Resolve the coverage gate and output-functionality gaps, rerun independent SPEC review with differentiated fixtures, reconcile the planning artifact, and only then consider separately authorized model qualification.
