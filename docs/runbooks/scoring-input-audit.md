# Scoring input audit — P1 PMI

**Scope:** `services/chemistry` P1 scorer, yield extraction boundary, and the P1 call in `/score`. Reviewed 2026-09-08. This is an input-validity correction, not validation of reaction outcomes or an LCA claim.

## Evidence path traced

1. `main.score_protocol` (`services/chemistry/main.py:140-180`) invokes `extract_yield_and_type`, obtains P2 output, then calls `score_p1`.
2. `yield_extractor.extract_yield_and_type` (`services/chemistry/yield_extractor.py:21-125`) is the sole P1 yield/product-mass extractor. Its data is returned in `ScoringResponse.yield_extraction` (`scoring/models.py:88-98`).
3. `score_p1` receives converted chemical masses from `ChemicalInput.quantity_g` (`scoring/models.py:7-16`). There are no other P1 callers in this repository search.
4. Reaction-class references originate in `reaction_types.py:1-10, 16-35`; P1 receives their typical efficiency/PMI fields through the extractor's benchmark attachment.

## Corrected decisions

- **No default input mass:** `score_p1` formerly replaced absent converted masses with `10 g` per chemical. Any non-positive/missing input mass now makes protocol PMI unavailable and lists the affected chemical names.
- **No product-mass inference from yield:** P1 no longer uses largest-reactant mass, half non-solvent mass, atom economy, or a class-average efficiency to create a product mass. A percentage yield remains context only.
- **Declared isolated product mass only:** PMI is calculated only from complete converted input masses and `yield_mass_g` that the extractor marks explicitly stated. Existing request data did not provide verified product molecular weight plus stoichiometric moles, so no stoichiometric derivation was implemented.
- **Benchmark is reference, not measurement:** with incomplete protocol inputs, P1 is unavailable (`score=-1`) and carries `benchmark_pmi`/typical efficiency as a `benchmark_reference_only` detail. It is not counted as a protocol score or compared against itself.
- **Extractor boundary:** the prompt now prohibits calculation/inference. Parsed values are accepted only with `confidence="stated"`, finite positive mass, and a yield percentage in `(0,100]`; inferred/malformed responses are surfaced as unavailable extraction values.
- **Provenance language:** a valid protocol PMI is `calculated` from declared product mass and converted input masses; `product_mass_source="declared"` documents that boundary. No stated percentage yield is labelled as a calculated product mass.

## Regression evidence

- `test_p1_scoring_inputs.py`: missing/partial quantities, percent yield without actual product mass, explicit product mass with stated yield, benchmark-only, and complete valid PMI.
- `test_yield_extractor_evidence.py`: rejects inferred extractor values; retains explicit stated values.
- `test_score_endpoint_full_principles.py`: verifies the endpoint passes explicit extracted product mass into P1.

## Neighboring P2 observation (outside this change)

`scoring/p2_atom_economy.py:138-194` continues to calculate a numeric atom-economy score for an unbalanced reaction SMILES and labels its confidence `benchmark` even though it uses no benchmark value. It also silently defaults an out-of-range desired product index to product zero (`157-160`). These are analogous input/provenance concerns: unbalanced or ambiguously selected reactions should not become normal numeric P2 results without an explicit policy. P2 was not modified under this P1-scoped task.

## Remaining limitations

- Yield/product-mass extraction is still LLM-mediated and not persisted as a canonical verified extraction snapshot. `confidence="stated"` is a constrained extractor assertion, not laboratory verification.
- `ChemicalInput.quantity_g` lacks field-level source/provenance and cannot distinguish a declared mass from conversion assumptions. A future scoring contract should carry quantity status and source per chemical.
- There is no located reaction corpus or validated mapping from reactant moles/product MW to a stoichiometric product amount; therefore P1 intentionally reports unavailable instead of estimating.
