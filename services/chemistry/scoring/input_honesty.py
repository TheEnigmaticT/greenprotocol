"""Validation and unavailable-score construction for deterministic scorers."""

from __future__ import annotations

import math

from scoring.models import ChemicalInput, PrincipleScore, ScoreProvenance


MASS_PROVENANCE = (
    "unavailable: mass-weighted calculation requires finite positive quantity_g "
    "for every evaluated chemical"
)
GHS_PROVENANCE = "unavailable: GHS hazard data is required for every evaluated chemical"


def finite_positive_mass(chemical: ChemicalInput) -> float | None:
    """Return a declared usable mass; never substitute a representative amount."""
    mass_g = chemical.quantity_g
    if mass_g is None or not math.isfinite(mass_g) or mass_g <= 0:
        return None
    return mass_g


def missing_mass_inputs(chemicals: list[ChemicalInput]) -> list[dict[str, str]]:
    """Describe every evaluated chemical lacking a usable declared mass."""
    return [
        {"chemical": chemical.name, "input": "quantity_g", "reason": "missing_or_nonpositive"}
        for chemical in chemicals
        if finite_positive_mass(chemical) is None
    ]


def missing_hcodes_inputs(
    chemicals: list[ChemicalInput], hcodes_map: dict[str, list[str]]
) -> list[dict[str, str]]:
    """Absent GHS lookup differs from a present lookup with no H-codes."""
    return [
        {"chemical": chemical.name, "input": "hcodes", "reason": "unavailable"}
        for chemical in chemicals
        if chemical.name not in hcodes_map
    ]


def unavailable_score(
    *,
    principle_number: int,
    principle_name: str,
    missing_inputs: list[dict[str, str]],
    provenance: str,
    data_sources: list[str],
    details: dict | None = None,
) -> PrincipleScore:
    """Create an explicit unavailable principle score without a numeric proxy."""
    return PrincipleScore(
        principle_number=principle_number,
        principle_name=principle_name,
        score=-1.0,
        normalized=-1.0,
        details={**(details or {}), "missing_inputs": missing_inputs, "provenance": provenance},
        confidence=ScoreProvenance.UNAVAILABLE,
        data_sources=data_sources,
    )
