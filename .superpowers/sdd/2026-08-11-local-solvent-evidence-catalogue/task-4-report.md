# Task 4 implementer report

Status: DONE

Commit: 932efac feat: expose local solvent evidence screening

Verification:
- `python3 -m pytest services/chemistry/test_solvent_screening.py services/chemistry/test_assistant_tools.py services/chemistry/test_solvent_evidence_import.py -q` — 21 passed.
- A local evidence test traps `assistant_tools.lookup_chemical`; no tested local path made a PubChem lookup.

Concern: Screening deliberately yields no candidates unless qualifying local measurements and complete local GHS profiles are present. Laboratory-validation warning is mandatory.

Review fix round:
- The generated SQLite index now persists canonical normalized solute SMILES and uses its `(normalized_solute_smiles, normalized_solvent, temperature_k)` index for bounded screening queries within ±0.01 K.
- Evidence and screening SQL queries fetch at most 21 rows, return at most 20, and report truncation.
- Screening citations now retain CHEM21, solubility sources, and full GHS source URL, snapshot path, SHA-256, and retrieval timestamp provenance.
- Rebuilt the local ignored evidence index from the checked-in assets: 53 CHEM21, 103,944 single-solubility, 175,626 mixture-solubility, and 2,210 density records.

Post-review verification:
- `python3 -m pytest services/chemistry/test_solvent_screening.py services/chemistry/test_assistant_tools.py services/chemistry/test_solvent_evidence_import.py -q` — 23 passed in 1.91s.
