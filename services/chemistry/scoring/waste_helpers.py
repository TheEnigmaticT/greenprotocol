"""Deterministic utility functions for waste analysis calculations.

These helpers operate on parsed chemical data and produce waste metrics
without any LLM involvement. All quantities must be pre-converted to kg
by the unit conversion pipeline before reaching these functions.
"""

from __future__ import annotations
from typing import Sequence
from .models import ChemicalInput


# ── H-code hazard category mappings ──────────────────────────────

# CMR: Carcinogenic, Mutagenic, Reproductive toxicity
CMR_HCODES = {
    "H340", "H341",  # mutagenicity
    "H350", "H351",  # carcinogenicity
    "H360", "H361",  # reproductive
}

TOXIC_HCODES = {
    "H300", "H301", "H310", "H311", "H330", "H331",  # acute toxicity
    "H370", "H371", "H372", "H373",  # organ toxicity
}

FLAMMABLE_HCODES = {
    "H220", "H221", "H222", "H223", "H224", "H225", "H226",
    "H228", "H241", "H242",
}

CORROSIVE_HCODES = {"H290", "H314", "H318"}

ENVIRONMENTAL_HCODES = {
    "H400", "H401", "H410", "H411", "H412", "H413",
}


SOLVENT_ROLES = {"solvent", "co-solvent", "wash solvent", "extraction solvent"}


def safe_kg(chem: ChemicalInput) -> float:
    """Return quantity_kg or 0.0 if missing."""
    return chem.quantity_kg or 0.0


def is_solvent(chem: ChemicalInput) -> bool:
    """Check if a chemical plays a solvent role."""
    return chem.role.lower().strip() in SOLVENT_ROLES


def sum_solvent_mass_kg(chemicals: Sequence[ChemicalInput]) -> float:
    """Total mass of solvent-role chemicals in kg."""
    return sum(safe_kg(c) for c in chemicals if is_solvent(c))


def sum_non_solvent_mass_kg(chemicals: Sequence[ChemicalInput]) -> float:
    """Total mass of non-solvent chemicals in kg."""
    return sum(safe_kg(c) for c in chemicals if not is_solvent(c))


def sum_liquid_mass_kg(chemicals: Sequence[ChemicalInput]) -> float:
    """Total mass of all liquids handled (solvents + liquid reagents).

    Heuristic: solvents are always liquid; other chemicals are liquid
    if they have a recorded density (implying a liquid measurement).
    """
    total = 0.0
    for c in chemicals:
        if is_solvent(c):
            total += safe_kg(c)
        elif c.quantity_kg and (c.quantity_g is not None or c.quantity_mol is not None):
            # Has mass — include if originally measured in mL (proxy: has density)
            total += safe_kg(c)
    return total


def categorize_hcodes(hcodes: list[str]) -> dict[str, bool]:
    """Categorize a list of H-codes into hazard buckets."""
    codes = set(hcodes)
    return {
        "toxic": bool(codes & TOXIC_HCODES),
        "cmr": bool(codes & CMR_HCODES),
        "flammable": bool(codes & FLAMMABLE_HCODES),
        "corrosive": bool(codes & CORROSIVE_HCODES),
        "environmental": bool(codes & ENVIRONMENTAL_HCODES),
    }


def bucket_hazard_chemicals(
    chemicals: Sequence[ChemicalInput],
    hcodes_map: dict[str, list[str]],
) -> dict[str, dict]:
    """Group chemicals into hazard buckets with total kg per bucket.

    Returns a dict like:
        {"toxic": {"totalKg": 1.2, "chemicals": ["DMF", "DCM"], "count": 2}, ...}
    """
    buckets: dict[str, dict] = {
        "toxic": {"totalKg": 0.0, "chemicals": [], "count": 0},
        "cmr": {"totalKg": 0.0, "chemicals": [], "count": 0},
        "flammable": {"totalKg": 0.0, "chemicals": [], "count": 0},
        "corrosive": {"totalKg": 0.0, "chemicals": [], "count": 0},
        "environmental": {"totalKg": 0.0, "chemicals": [], "count": 0},
    }

    for chem in chemicals:
        codes = hcodes_map.get(chem.name, [])
        cats = categorize_hcodes(codes)
        kg = safe_kg(chem)
        for cat, flagged in cats.items():
            if flagged:
                buckets[cat]["totalKg"] += kg
                buckets[cat]["chemicals"].append(chem.name)
                buckets[cat]["count"] += 1

    return buckets
