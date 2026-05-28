#!/usr/bin/env python3
"""Backfill RDKit-estimated density for cached chemicals that have null density_g_per_ml."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHEMISTRY_DIR = ROOT / "services" / "chemistry"
DEFAULT_CACHE = ROOT / "data" / "chemical-seeds" / "pubchem-cache.generated.json"

sys.path.insert(0, str(CHEMISTRY_DIR))

from pubchem import estimate_density_rdkit  # noqa: E402


def backfill(cache_path: Path, dry_run: bool) -> None:
    with open(cache_path) as f:
        cache: dict[str, dict] = json.load(f)

    updated = 0
    skipped = 0
    failed = 0

    for key, entry in cache.items():
        if key.startswith("ghs_"):
            continue
        if not isinstance(entry, dict):
            continue
        if entry.get("density_g_per_ml") is not None:
            # Tag existing PubChem entries that predate the density_source field.
            if "density_source" not in entry:
                if not dry_run:
                    entry["density_source"] = "pubchem"
                updated += 1
            else:
                skipped += 1
            continue

        smiles = entry.get("canonical_smiles")
        mw = entry.get("molecular_weight")
        if not smiles or not mw:
            failed += 1
            continue

        density = estimate_density_rdkit(smiles, float(mw))
        if density is None:
            failed += 1
            continue

        if not dry_run:
            entry["density_g_per_ml"] = density
            entry["density_source"] = "calculated_rdkit"
        updated += 1

    print(f"Updated:  {updated}")
    print(f"Skipped (already had density): {skipped}")
    print(f"Failed (no SMILES/MW or embed error): {failed}")

    if dry_run:
        print("Dry run — no changes written.")
        return

    temp = cache_path.with_suffix(cache_path.suffix + ".tmp")
    with open(temp, "w") as f:
        json.dump(cache, f, indent=2, sort_keys=True)
        f.write("\n")
    temp.replace(cache_path)
    print(f"Saved: {cache_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache", type=Path, default=DEFAULT_CACHE,
        help="Path to the generated cache JSON (default: pubchem-cache.generated.json)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Report counts without writing changes",
    )
    args = parser.parse_args()

    if not args.cache.exists():
        print(f"Cache file not found: {args.cache}", file=sys.stderr)
        return 1

    backfill(args.cache, args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
