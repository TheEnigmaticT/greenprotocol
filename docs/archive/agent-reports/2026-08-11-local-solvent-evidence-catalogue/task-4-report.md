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

Review fix round 2:
- SQL uses a narrow `±0.010001 K` superset so binary floating-point cannot omit a mathematical `±0.01 K` boundary; the screening predicate performs the final decimal-exact `±0.01 K` check.
- New imports emit schema version 2. Opening a preexisting version-1 index deterministically migrates the normalized solute column and index before screening queries; the migration regression covers a legacy v1 SQLite file.
- `python3 -m pytest services/chemistry/test_solvent_screening.py services/chemistry/test_assistant_tools.py services/chemistry/test_solvent_evidence_import.py -q` — 24 passed in 2.84s.

Review fix round 3:
- Screening pages the SQL temperature superset and applies the decimal-exact predicate before the 20-row cap, so outer-sliver rows cannot displace a valid `±0.01 K` observation.
- Legacy migration now starts `BEGIN IMMEDIATE` before `ALTER TABLE`; it backfills, verifies no missing normalized keys, verifies the index, then upgrades schema metadata. A forced conversion failure rolls the transaction back to usable v1 before a later successful resume.
- `python3 -m pytest services/chemistry/test_solvent_screening.py services/chemistry/test_assistant_tools.py services/chemistry/test_solvent_evidence_import.py -q` — 24 passed in 1.98s.
