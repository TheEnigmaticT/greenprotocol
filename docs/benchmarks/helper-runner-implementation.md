# Isolated Python helper execution adapter

## Implemented boundary

`services/chemistry/isolated_helper_runner.py` exports:

```python
await run_helpers(
    protocol_text=full_source,
    source_hash=sha256(full_source.encode("utf-8")).hexdigest(),
    model=approved_model,
    steps=steps,
    chemicals=chemicals,
    transport=async_parent_callback,
)
```

This invokes the existing functions, not surrogate implementations:

- `yield_extractor.extract_yield_and_type`
- `smiles_extractor.extract_reaction_smiles` (including its real RDKit validation/retries)
- `scoring.p8_reduce_derivatives.score_p8`
- `scoring.p11_realtime_analysis.score_p11`

All calls execute inside `isolated_llm_policy`. The model allowlist is imported from that policy unchanged; it currently permits only the reviewed Gemma entry, not pending Qwen. No provider endpoints, credentials, deterministic calculations, or legacy routing fallback are implemented here.

The async callback receives the existing immutable `HelperRequest(model, stage, source_hash, prompt, system)` and must return exactly `{model, text, attempt_id}`. `attempt_id` is a lowercase 64-character hex identifier from the parent. The parent TypeScript live provider owns **all** spending, reservations, retry accounting, mission checks, cancellation settlement, and uniqueness/ledger verification. Python counters measure callbacks, not paid attempts or cost.

## Private return contract

```text
{
  source_hash, model,
  attempted_callbacks, failed_callbacks,
  helpers: {
    yield|smiles|p8|p11: {
      status: complete|unavailable,
      attempted_callbacks, failed_callbacks,
      error: null|helper_unavailable|helper_failed,
      value: private_helper_dict|null
    }
  }
}
```

Invalid input raises the sanitized `ValueError("isolated_input_invalid")` before any callback. Ordinary helper failures do not prevent later helpers from running. Cancellation propagates rather than being converted into completion.

A failed callback remains independently counted even if a legacy helper catches the error and constructs a plausible fallback score. Such a helper cannot become complete. Invalid envelopes and invalid structured payloads count as failed callbacks. Real SMILES validation failure is a helper-unavailable result, not a failed transport callback. No raw parse errors or failed values are returned.

## Validation and provenance

The SHA-256 is verified over the entire UTF-8 source, not the legacy prompt's truncated prefix. The legacy functions still truncate their prompts internally; this adapter does not claim full-source model review.

The input is a deliberately strict lossless subset, rather than the permissive `ScoringRequest`:

- Each chemical has exactly string `name`, `role`, and `quantity`. Name and any nonempty quantity must occur literally in its source step. Roles are limited to solvent, reagent, reactant, catalyst, product, byproduct, unknown.
- Each step has exactly `stepNumber`, `description`, `chemicals`, and `conditions`. Step numbers are contiguous positive integers, not booleans. Descriptions are literal, non-overlapping source excerpts in source order.
- Conditions may contain temperature, duration, pressure, atmosphere; every value is a nonempty literal string in its step.
- Top-level chemicals equal the multiset of step chemical occurrences, including repeated occurrences. They are not a deduplicated inventory.
- Arbitrary extra fields, computed quantities, changed names, paraphrased steps, and unrelated rescore/provenance payloads are rejected. Validated inputs are copied before awaiting callbacks.

This is structural/source anchoring, not scientific verification of inferred roles or authorization of an edited scenario. The parent must supply authoritative source/graph binding and independently reviewed scenario provenance. Do not use this helper runner as a provenance-bypass rescore endpoint.

Responses are checked before legacy parsing: yield fields and numeric bounds, exhaustive/unique P8 step IDs and known classes, and P11 score bounds, typed monitoring entries, known step IDs and literal source evidence. This prevents missing P11 scores becoming its default score and unknown P8 classifications becoming concession defaults. Semantic plausibility still requires parent review.

An existing `PrincipleScore` validator maps the string-valued `MODEL_INFERRED` enum incorrectly to `calculated`. The adapter preserves that returned field as `legacy_confidence` and explicitly **weakens** the exported confidence to `model-inferred` for P8/P11. It does not alter scoring math or the shared model class. This avoids falsely presenting model-dependent results as deterministic.

## Process integration remaining

No subprocess/stdio IPC entrypoint is implemented in this increment. The parent must wire the async transport over a private IPC channel and validate each request against its mission/ledger. Use a dedicated sequential Python worker, not a shared web process: Python stdout/stderr suppression is process-global. The return dictionary, prompts, successful model values, and any child stdout/stderr must remain private. Never relay child streams to user-visible logs; native extension diagnostics can bypass Python stream redirection. Shared reports may include only aggregate counts and sanitized status/error codes.

## Offline verification

Run from the repository root:

```sh
/opt/homebrew/bin/python3.14 -m pytest services/chemistry/test_isolated_helper_runner.py services/chemistry/test_isolated_llm_boundary.py -q --tb=short
```

TDD evidence: the original 16 tests failed specifically because the runner was absent. Implementation then passed those tests plus the four existing policy-boundary tests. A subsequent source-order regression failed before the ordering guard was added. Expanded regressions cover all four real helpers, provider/network prohibition, malformed envelopes, missing/defaulted data, source identity, changed chemical names, incoherent step data, swallowed exceptions, real SMILES failure, and cancellation.

Synthetic transports only; no private corpus, model network, credentials, packages installed, commits, or pushes. This is helper-execution qualification, **not live chemistry parity**, full scientific validation, or end-to-end spend-ledger verification.
