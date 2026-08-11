#!/usr/bin/env python3
"""Build the generated local solvent evidence SQLite index."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "chemistry"))

from solvent_evidence_import import build_index


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", required=True, type=Path)
    parser.add_argument("--manifests", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    report = build_index(args.raw, args.manifests, args.output)
    print(f"Built solvent evidence index: {report.index_path}")
    print(f"CHEM21 records: {report.record_counts['chem21']}")
    print(f"Single-solubility records: {report.record_counts['single_solubility']}")
    print(f"Mixture-solubility records: {report.record_counts['mixture_solubility']}")
    print(f"Density records: {report.record_counts['density']}")


if __name__ == "__main__":
    main()
