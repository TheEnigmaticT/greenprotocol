#!/usr/bin/env python3
"""Build the generated local solvent evidence SQLite index."""

from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "chemistry"))

from solvent_evidence_import import main


if __name__ == "__main__":
    main()
