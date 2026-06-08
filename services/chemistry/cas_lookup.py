"""Name -> CAS registry number lookup for the seeded common-chemical set.

Sourced from data/chemical-seeds/chemical-seed-list.generated.json (the ranked
~5,000 common chemicals, EPA CompTox + curated lab set), flattened to a
name->casrn map at build time and shipped alongside the service as
cas_seed.json. Loaded lazily and cached in memory.

CAS is used for display, citation, and regulatory (RCRA) matching — never for
scoring.
"""

from __future__ import annotations

import json
from pathlib import Path

_CAS_FILE = Path(__file__).with_name("cas_seed.json")
_cas_by_name: dict[str, str] | None = None


def _load() -> dict[str, str]:
    global _cas_by_name
    if _cas_by_name is None:
        try:
            with open(_CAS_FILE) as f:
                _cas_by_name = json.load(f)
        except (json.JSONDecodeError, OSError):
            _cas_by_name = {}
    return _cas_by_name


def get_cas(name: str) -> str | None:
    """Return the CAS number for a chemical name, or None if unknown."""
    if not name:
        return None
    return _load().get(name.strip().lower())
