"""Deterministic helpers for protocol inventory and hazard observations.

Pre-converted quantities are observations of parsed inputs, not evidence of
waste generation, liquid phase, recovery, or disposal.
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
    """Legacy numeric accessor; never use it to represent a missing mass."""
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


def observed_input_inventory(chemicals: Sequence[ChemicalInput]) -> dict:
    """Return declared/converted non-product input masses without calling them waste.

    Quantity conversion does not establish material phase, recovery, or disposal.
    Keep missing masses explicit rather than replacing them with numeric zero.
    """
    inputs = [c for c in chemicals if c.role.lower().strip() != "product"]
    known = [c for c in inputs if c.quantity_kg is not None]
    unknown = [c for c in inputs if c.quantity_kg is None]
    if not known:
        coverage = "unavailable"
        known_mass = None
    elif unknown:
        coverage = "partial"
        known_mass = round(sum(c.quantity_kg or 0.0 for c in known), 4)
    else:
        coverage = "complete"
        known_mass = round(sum(c.quantity_kg or 0.0 for c in known), 4)
    return {
        "knownInputMassKg": known_mass,
        "knownMassChemicalCount": len(known),
        "chemicalsWithUnknownMassCount": len(unknown),
        "massCoverage": coverage,
    }


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
        known_mass = chem.quantity_kg is not None
        kg = chem.quantity_kg if known_mass else 0.0
        for cat, flagged in cats.items():
            if flagged:
                buckets[cat]["totalKg"] += kg
                buckets[cat]["chemicals"].append(chem.name)
                buckets[cat]["count"] += 1
                buckets[cat].setdefault("knownMassCount", 0)
                buckets[cat]["knownMassCount"] += int(known_mass)

    for bucket in buckets.values():
        if bucket["count"] == 0:
            bucket["massCoverage"] = "unavailable"
            bucket["totalKg"] = None
        elif bucket["knownMassCount"] == 0:
            bucket["massCoverage"] = "unavailable"
            bucket["totalKg"] = None
        elif bucket["knownMassCount"] < bucket["count"]:
            bucket["massCoverage"] = "partial"
            bucket["totalKg"] = None
        else:
            bucket["massCoverage"] = "complete"
        bucket.pop("knownMassCount", None)

    return buckets
