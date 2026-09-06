# Independent SPEC review — actual Python helper runner

## Verdict

**PASS for the injected-transport, offline helper-execution increment only.** No blocking specification mismatch found. This is not QUALITY approval, permission to activate live execution, IPC qualification, chemistry parity, deterministic rescore authority, or spend-ledger verification. A separate independent QUALITY review must follow this SPEC review.

## Scope and evidence

Inspected `services/chemistry/isolated_helper_runner.py`, its tests, `isolated_llm_policy.py`, the policy-boundary tests, `llm_client.py`, all four actual helper implementations, the shared confidence validator, and `docs/benchmarks/helper-runner-implementation.md`. Reviewed the tracked chemistry diff against HEAD: each helper changes only its explicit stage keyword; the LLM client adds early isolated routing. No scoring formulas or shared scoring models changed in that diff.

Executed from the worktree root:

```sh
/opt/homebrew/bin/python3.14 -m pytest services/chemistry/test_isolated_helper_runner.py services/chemistry/test_isolated_llm_boundary.py -q --tb=short
```

Actual result: **28 passed in 0.23s**. Tests use synthetic transports and prohibit legacy provider functions and socket connections. No model requests, private corpus reads, credential inspection, installs, commits, or pushes were performed. The implementation document's historical RED/TDD claims were not independently reproduced and are not evidence for this verdict.

## Specification checks

| Requirement | Finding |
|---|---|
| Invoke the real four helpers | PASS. Runner lines 155–171 invoke `extract_yield_and_type`, `extract_reaction_smiles`, `score_p8`, and `score_p11` under `isolated_llm_policy`, rather than substituting rewritten algorithms. The actual-four-helper test exercises these paths through an injected synthetic callback. |
| Exact API and transport envelope | PASS. Keyword-only `run_helpers(protocol_text, source_hash, model, steps, chemicals, transport)` matches the documented API. Immutable `HelperRequest` carries model/stage/source hash/prompt/system. Callback response requires exactly model/text/attempt_id, matching identity, a lowercase 64-hex attempt identifier, and bounded nonempty text. |
| Full-source identity and coherent literal inputs | PASS. Runner lines 31–72 recompute the full UTF-8 SHA-256; require contiguous integer step IDs, literal ordered non-overlapping descriptions, exact allowed fields, literal quantities/conditions, and equal top-level/nested chemical Counters. Inputs are copied before awaits. This is structural binding, not proof that a role, quantity relationship, or scenario is scientifically authoritative. |
| Callback failures cannot become completion | PASS. Attempted/failed counters sit outside legacy helper results (lines 137–150). Completion requires a valid helper result, at least one callback, and zero failed callbacks (179–182). Tests cover every stage's transport failure, malformed envelopes/payloads, and a swallowed failure that produces a plausible P11 fallback. Ordinary failure permits later helpers; cancellation propagates. |
| Validate before legacy defaults | PASS. Yield shape/numeric bounds, exhaustive unique P8 IDs/known classes, and P11 score/monitoring structures/literal evidence are checked before parsing in legacy helpers. Missing P11 scores and unsupported P8 classifications cannot acquire successful default scores. |
| Actual SMILES behavior retained | PASS. The runner delegates validation and retry behavior to the existing helper. Malformed SMILES exercises its two callback attempts and remains unavailable. SMILES content rejection is helper unavailability, not a failed transport callback. The success test is conditional on RDKit availability; this test result alone does not certify installed RDKit or a successful RDKit path. |
| Conservative confidence, unchanged math | PASS. P8/P11 exported confidence is explicitly weakened to `model-inferred`; the legacy field is retained separately as `legacy_confidence` (174–178). The shared string-enum validator explains the legacy `calculated` result. No scoring formulas are rewritten. |
| No direct provider/fallback or allowlist expansion | PASS. Isolation intercepts before legacy provider configuration. Runner/policy implement no network transport. The allowlist remains the existing exact Gemma entry; Qwen is pending. Parent transport remains responsible for every paid attempt, reservation, retry charge, cancellation settlement, and attempt-ID uniqueness. Python counts callbacks, not costs. |
| IPC/live work explicitly pending | PASS. Implementation documentation explicitly says no subprocess/stdio entrypoint exists and requires private IPC, mission validation and ledger integration in a later increment. |

## Limits and follow-on gates

- Full-source hashing does not remove existing prompt truncation: yield/SMILES/P11 use 3,000-character protocol prefixes, P8 uses 2,000, with separate helper context appended. No full-source model-review claim is justified.
- P11 evidence is checked against the full source, not necessarily its referenced step. Inferred roles, response semantics, SMILES atom balance and scientific usefulness remain outside this structural adapter's proof. Existing SMILES validation checks molecule parsing, not atom balance.
- No automatic rescore or edited-scenario authority follows from literal substrings and matching hashes. Parent source/graph binding and independently reviewed scenario provenance remain mandatory.
- Global stdout/stderr redirection requires a dedicated sequential worker. Native extension diagnostics can bypass it; IPC must keep child streams and successful private values out of shared logs. `legacy_confidence` must not override the conservative exported confidence.
- Before live integration: complete separate QUALITY review, private IPC and cancellation/timeout settlement tests, parent ledger/retry/identity validation, and explicit integration approval. These are pending gates, not satisfied by this PASS.

## Review environment notes

`git fetch --all --prune` succeeded. Active worktree HEAD matched `origin/main` (0/0); another worktree's local `main` was eight commits behind and was not modified. Existing dirty/untracked work was preserved. The referenced external dev-protocol file was not found. An optional inline diagnostic was blocked by command approval policy and was not bypassed; no diagnostic result is claimed. The pytest verification above completed successfully. Only this review document was created by this reviewer.
