"""Deterministic helpers for protocol inventory and hazard observations.

Pre-converted quantities are observations of parsed inputs, not evidence of
waste generation, liquid phase, recovery, or disposal. Mass values that are
missing, nonpositive, or nonfinite must never be coerced to 0.0 and folded
into an authoritative total — that would silently turn no-measurement into
a confident measurement. ``finite_positive_kg`` is the single source of
truth for "is this mass usable?"; ``safe_kg`` is kept only for backwards
compatibility with other call sites and is documented as legacy.

Product-role chemicals are outputs, not consumed inputs. They are excluded
from the observed input inventory and from the input hazard buckets, so a
protocol's product can never be counted as input mass or as a hazardous
input. The canonical product vocabulary is owned by
``scoring.p4_product_toxicity`` (``PRODUCT_ROLES``) so every scorer agrees
on what a product is.
"""

from __future__ import annotations
import math
from typing import Sequence
from .models import ChemicalInput
from .p4_product_toxicity import PRODUCT_ROLES


# ── H-code hazard category mappings ──────────────────────────────────

CMR_HCODES = {
    "H340", "H341",
    "H350", "H351",
    "H360", "H361",
}
TOXIC_HCODES = {
    "H300", "H301", "H310", "H311", "H330", "H331",
    "H370", "H371", "H372", "H373",
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


def is_product_role(chem: ChemicalInput) -> bool:
    """True when a chemical is a product/output instead of a consumed input.

    Mirrors the product detection used by P4 (product toxicity): the
    normalized role is either one of the canonical ``PRODUCT_ROLES``
    synonyms ("product", "desired product", "target", "intermediate",
    "final product", "main product") or explicitly names a product.
    """
    role = (chem.role or "").lower().strip()
    return role in PRODUCT_ROLES or "product" in role


def finite_positive_kg(chem: ChemicalInput) -> float | None:
    """Return declared usable mass in kg; never substitute a representative amount.

    A chemical is mass-usable iff ``quantity_kg`` is a finite, strictly positive
    number. ``None``, ``0``, negative, NaN, or +/-inf all return ``None`` so the
    caller can surface explicit missing-input reasons instead of pretending the
    chemical contributed 0 kg to a waste total.
    """
    kg = chem.quantity_kg
    if kg is None:
        return None
    if not isinstance(kg, (int, float)):
        return None
    if isinstance(kg, float) and not math.isfinite(kg):
        return None
    if kg <= 0:
        return None
    return float(kg)


def safe_kg(chem: ChemicalInput) -> float:
    """Legacy numeric accessor. Returns 0.0 for missing mass.

    Callers that need to distinguish "no measurement" from "0 kg" must use
    :func:`finite_positive_kg` instead. This shim is retained only so other
    out-of-scope modules keep compiling while they migrate.
    """
    kg = chem.quantity_kg
    if kg is None:
        return 0.0
    if isinstance(kg, float) and not math.isfinite(kg):
        return 0.0
    return float(kg or 0.0)


def is_solvent(chem: ChemicalInput) -> bool:
    """Check if a chemical plays a solvent role."""
    return chem.role.lower().strip() in SOLVENT_ROLES


def sum_solvent_mass_kg(chemicals: Sequence[ChemicalInput]) -> float:
    """Total mass of solvent-role chemicals in kg (legacy, missing→0)."""
    return sum(safe_kg(c) for c in chemicals if is_solvent(c))


def sum_non_solvent_mass_kg(chemicals: Sequence[ChemicalInput]) -> float:
    """Total mass of non-solvent chemicals in kg (legacy, missing→0)."""
    return sum(safe_kg(c) for c in chemicals if not is_solvent(c))


def observed_input_inventory(chemicals: Sequence[ChemicalInput]) -> dict:
    """Return declared/converted non-product input masses without calling them waste.

    Quantity conversion does not establish material phase, recovery, or disposal.
    Coverage is explicit:
      * "unavailable" — no chemical carries a finite positive mass,
      * "partial"     — at least one known, at least one missing,
      * "complete"    — every non-product input has a finite positive mass.

    Product-role chemicals are outputs and are excluded from both the mass
    totals and the coverage denominators.
    """
    products = [c for c in chemicals if is_product_role(c)]
    inputs = [c for c in chemicals if not is_product_role(c)]
    known = [c for c in inputs if finite_positive_kg(c) is not None]
    unknown = [c for c in inputs if finite_positive_kg(c) is None]
    if not known:
        coverage = "unavailable"
        known_mass: float | None = None
    elif unknown:
        coverage = "partial"
        known_mass = round(sum(finite_positive_kg(c) or 0.0 for c in known), 4)
    else:
        coverage = "complete"
        known_mass = round(sum(finite_positive_kg(c) or 0.0 for c in known), 4)
    return {
        "knownInputMassKg": known_mass,
        "knownMassChemicalCount": len(known),
        "chemicalsWithUnknownMassCount": len(unknown),
        "massCoverage": coverage,
        "productChemicalsExcludedCount": len(products),
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
    """Group input chemicals into hazard buckets, carrying per-bucket mass coverage.

    Product-role chemicals are skipped: a product is an output whose toxicity
    is scored by P4, not a hazardous input consumed by the protocol.

    Observed hazard flags remain visible qualitatively (chemical names +
    counts) even when one or more flagged chemicals lack a usable mass.
    ``totalKg`` is reported only when every flagged chemical in that bucket
    carries a finite positive mass; otherwise it is ``None`` and the
    ``massCoverage`` field says ``"partial"`` or ``"unavailable"`` so the
    caller knows the segment is qualitative, not summable. When present,
    ``totalKg`` is observed *input* mass — never measured waste.
    """
    buckets: dict[str, dict] = {
        "toxic": {"totalKg": 0.0, "chemicals": [], "count": 0, "knownMassCount": 0},
        "cmr": {"totalKg": 0.0, "chemicals": [], "count": 0, "knownMassCount": 0},
        "flammable": {"totalKg": 0.0, "chemicals": [], "count": 0, "knownMassCount": 0},
        "corrosive": {"totalKg": 0.0, "chemicals": [], "count": 0, "knownMassCount": 0},
        "environmental": {"totalKg": 0.0, "chemicals": [], "count": 0, "knownMassCount": 0},
    }

    for chem in chemicals:
        if is_product_role(chem):
            # Outputs are not inputs: never report a product as a hazardous
            # input or fold its mass into an input hazard bucket.
            continue
        codes = hcodes_map.get(chem.name)  # absent lookup ≠ verified safety
        if codes is None:
            continue
        cats = categorize_hcodes(codes)
        kg = finite_positive_kg(chem)
        for cat, flagged in cats.items():
            if flagged:
                buckets[cat]["count"] += 1
                buckets[cat]["chemicals"].append(chem.name)
                if kg is not None:
                    buckets[cat]["totalKg"] += kg
                    buckets[cat]["knownMassCount"] += 1

    for bucket in buckets.values():
        count = bucket["count"]
        known = bucket["knownMassCount"]
        if count == 0:
            bucket["massCoverage"] = "unavailable"
            bucket["totalKg"] = None
        elif known == 0:
            bucket["massCoverage"] = "unavailable"
            bucket["totalKg"] = None
        elif known < count:
            bucket["massCoverage"] = "partial"
            bucket["totalKg"] = None
        else:
            bucket["massCoverage"] = "complete"
            bucket["totalKg"] = round(bucket["totalKg"], 4)
        bucket.pop("knownMassCount", None)

    return buckets
