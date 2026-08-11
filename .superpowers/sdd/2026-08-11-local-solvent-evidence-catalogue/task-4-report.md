# Task 4 report — local solvent evidence and screening

## Status

Complete. The chemistry service now exposes token-protected, local-only `solvent_evidence`, `solvent_hazard`, and `solvent_screening` operations through a discriminated Pydantic request union.

- Evidence requests validate mode-specific identifiers and finite temperatures before accessing SQLite, return raw local rows, and cap output at 20 rows with a truncation warning.
- Hazard requests use only the local indexed evidence store and return only complete harvested GHS profiles.
- Screening uses only explicit CHEM21 replacement relations, exact RDKit-normalized solute structure matches, measurements within ±0.01 K, mole-fraction solubility, and a strict no-regression/at-least-one-improvement partial order across CMR, acute, organ, environment, and physical hazard categories.
- Screening results are limited to `laboratory_screening`, include measured rows, hazard comparison, citations, CHEM21 relation, and the mandatory compatibility/rate/selectivity/catalyst/workup/crystallization/scale-up warning.

## Test-first evidence

Initial focused test run failed as expected because `solvent_screening` and local request support did not exist:

```text
ModuleNotFoundError: No module named 'solvent_screening'
AttributeError: assistant_tools has no attribute get_store
```

Final focused regression command:

```text
python3 -m pytest services/chemistry/test_solvent_screening.py services/chemistry/test_assistant_tools.py services/chemistry/test_solvent_evidence_import.py -q
21 passed in 2.12s
```

The local-evidence test replaces `assistant_tools.lookup_chemical` with an immediate failure and passes, confirming that the local evidence path does not call the PubChem lookup.

## Concerns

Screening correctly returns no candidates when the local SQLite index has no complete GHS profile or no qualifying same-solute, same-temperature mole-fraction measurements. The returned `laboratory_screening` status is intentionally not a substitution endorsement; process-specific laboratory validation remains mandatory.
