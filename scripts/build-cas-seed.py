#!/usr/bin/env python3
"""Build services/chemistry/cas_seed.json (name -> CAS) from the seed list.

Flattens data/chemical-seeds/chemical-seed-list.generated.json (the ranked
~5,000 common chemicals) into a lowercase-name -> casrn map shipped with the
chemistry service for CAS resolution and RCRA matching.

Run from repo root after regenerating the seed list:

    python3 scripts/build-cas-seed.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data/chemical-seeds/chemical-seed-list.generated.json"
OUT = ROOT / "services/chemistry/cas_seed.json"


def main() -> None:
    src = json.loads(SRC.read_text())
    records: list[dict] = []
    for value in src.values():
        if isinstance(value, list):
            records.extend(value)

    cas_by_name: dict[str, str] = {}
    for rec in records:
        name = (rec.get("name") or "").strip().lower()
        cas = ((rec.get("identifiers") or {}).get("casrn") or "").strip()
        if name and cas:
            cas_by_name.setdefault(name, cas)

    OUT.write_text(json.dumps(cas_by_name, indent=0, sort_keys=True))
    print(f"Wrote {OUT} — {len(cas_by_name)} name->CAS entries from {len(records)} records")


if __name__ == "__main__":
    main()
