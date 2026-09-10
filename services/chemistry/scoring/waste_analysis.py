"""Structured protocol inventory and waste-availability boundary.

Parsed inputs, GHS flags, and process counts do not establish generated
waste, liquid phase, recovery, or final disposition. Until a protocol supplies
those data, this module emits a versioned unavailable waste estimate alongside
the source-grounded observations that remain reportable.
"""

from __future__ import annotations
from typing import Sequence

from .models import ChemicalInput
from .waste_helpers import (
    observed_input_inventory,
    bucket_hazard_chemicals,
)


# ── Grade thresholds ─────────────────────────────────────────────

def _grade(score: float) -> str:
    """Convert 0-10 score to letter grade."""
    if score <= 2.0:
        return "A"
    elif score <= 4.0:
        return "B"
    elif score <= 6.0:
        return "C"
    elif score <= 8.0:
        return "D"
    return "F"


# ── Penalty sub-scores ───────────────────────────────────────────

def _solvent_penalty(solvent_kg: float, total_kg: float) -> float:
    """0-3 penalty based on solvent mass fraction and absolute mass."""
    if total_kg == 0:
        return 0.0
    fraction = solvent_kg / total_kg
    # Fraction-based: >80% solvent is very wasteful
    frac_score = min(fraction * 3.0, 3.0)
    # Absolute mass bump: >1 kg solvent adds up to 1.0
    abs_bump = min(solvent_kg / 2.0, 1.0)
    return min((frac_score + abs_bump) / 2.0, 3.0)


def _hazard_penalty(buckets: dict[str, dict]) -> float:
    """0-3 penalty based on hazardous chemical presence and mass."""
    score = 0.0
    # CMR is worst
    if buckets["cmr"]["count"] > 0:
        score += 1.5
    # Acute toxicity
    if buckets["toxic"]["count"] > 0:
        score += min(buckets["toxic"]["totalKg"] * 1.0, 1.0)
    # Environmental hazard
    if buckets["environmental"]["count"] > 0:
        score += 0.5
    return min(score, 3.0)


def _liquid_burden_penalty(liquid_kg: float) -> float:
    """0-2 penalty for total liquid throughput."""
    # >2 kg liquid is significant for lab scale
    return min(liquid_kg / 2.0, 2.0)


def _process_burden_penalty(
    purification_count: int,
    wash_step_count: int,
    transfer_count: int,
) -> float:
    """0-2 penalty for process complexity related to waste."""
    # Each purification/wash step generates waste
    steps = purification_count + wash_step_count
    step_score = min(steps * 0.4, 1.5)
    transfer_score = min(transfer_count * 0.1, 0.5)
    return min(step_score + transfer_score, 2.0)


# ── Primary driver logic ─────────────────────────────────────────

def _worst_category(
    solvent_penalty: float,
    hazard_penalty: float,
    liquid_penalty: float,
    process_penalty: float,
) -> str:
    """Pick the single most impactful waste-driver category."""
    penalties = {
        "solvent": solvent_penalty,
        "hazard": hazard_penalty,
        "liquid": liquid_penalty,
        "process": process_penalty,
    }
    return max(penalties, key=penalties.get)  # type: ignore[arg-type]


def _identify_primary_driver(worst: str, buckets: dict[str, dict]) -> str:
    """One-sentence explanation of the dominant waste driver."""
    if worst == "hazard":
        if buckets["cmr"]["count"] > 0:
            chems = ", ".join(buckets["cmr"]["chemicals"][:3])
            return f"CMR-classified chemicals ({chems}) dominate the hazard profile."
        chems = ", ".join(buckets["toxic"]["chemicals"][:3])
        return f"Acute toxicity from {chems} is the primary waste concern."
    elif worst == "solvent":
        return "High solvent mass fraction drives overall waste volume."
    elif worst == "liquid":
        return "Large liquid throughput increases handling and disposal burden."
    else:
        return "Complex purification/cleanup steps generate significant waste."


def _best_next_action(worst: str, buckets: dict[str, dict]) -> str:
    """The single highest-leverage next action for the dominant driver."""
    if worst == "hazard":
        if buckets["cmr"]["count"] > 0:
            return "Substitute or eliminate the CMR-classified chemical(s) to cut hazardous waste."
        return "Replace the highest-toxicity reagent with a safer alternative (see P3/P5)."
    elif worst == "solvent":
        return "Reduce solvent charge or switch to a greener solvent to cut waste volume (see P5)."
    elif worst == "liquid":
        return "Consolidate wash/extraction steps to lower liquid handling and disposal burden."
    else:
        return "Telescope or one-pot the purification-heavy steps to reduce cleanup waste."


# ── Main entry point ─────────────────────────────────────────────

def compute_waste_analysis(
    chemicals: Sequence[ChemicalInput],
    hcodes_map: dict[str, list[str]],
    process_metrics: dict | None = None,
) -> dict:
    """Compute a full structured waste analysis.

    Args:
        chemicals: Parsed chemicals with quantities in kg.
        hcodes_map: Chemical name -> list of GHS H-codes.
        process_metrics: Optional dict with transfer_count, vessel_count,
            purification_count, wash_step_count from process complexity scoring.

    Returns:
        Dict matching the WasteAnalysis TypeScript interface shape.
    """
    pm = process_metrics or {}
    transfer_count = pm.get("transfer_count", 0)
    vessel_count = pm.get("vessel_count", 0)
    purification_count = pm.get("purification_count", 0)
    wash_step_count = pm.get("wash_step_count", 0)
    workflow_complexity = pm.get("workflow_complexity", 0)

    inventory = observed_input_inventory(chemicals)
    buckets = bucket_hazard_chemicals(chemicals, hcodes_map)
    has_hcodes = any(len(codes) > 0 for codes in hcodes_map.values())

    # Quantity conversion and operation counts do not establish which material
    # became waste, whether it was recovered, or its final disposition.
    sources = []
    if inventory["knownMassChemicalCount"]:
        sources.append("PubChem/RDKit unit conversion")
    if has_hcodes:
        sources.append("GHS PUG-View H-codes")
    if process_metrics:
        sources.append("Process complexity analysis")

    return {
        "version": "waste-analysis/v2",
        "availability": {
            "actualWasteMass": "unavailable",
            "liquidDisposition": "unavailable",
            "reason": "Actual waste generation and liquid disposition were not reported in the submitted protocol.",
        },
        "summary": {
            "wasteImpactScore": -1,
            "grade": "unavailable",
            "primaryDriver": "Actual waste generation is unknown.",
            "bestNextAction": "Record waste streams and disposition to estimate waste.",
            "confidence": "unavailable",
        },
        "observedInputInventory": inventory,
        "directWaste": {
            "totalWasteKg": None,
            "solventWasteKg": None,
            "nonSolventWasteKg": None,
        },
        "hazardSegments": [
            {
                "category": cat,
                "totalKg": round(data["totalKg"], 4) if data["totalKg"] is not None else None,
                "chemicalsCount": data["count"],
                "chemicals": data["chemicals"],
                "massCoverage": data["massCoverage"],
            }
            for cat, data in buckets.items()
            if data["count"] > 0
        ],
        "liquidBurden": {
            "totalLiquidHandledKg": None,
            "totalLiquidDiscardedKg": None,
        },
        "processBurden": {
            "transferCount": transfer_count,
            "vesselCount": vessel_count,
            "purificationCount": purification_count,
            "washStepCount": wash_step_count,
            "workflowComplexity": workflow_complexity,
        },
        "upstream": {
            "lcaAvailable": False,
            "notes": "Upstream LCA data not yet integrated.",
        },
        "evidenceSources": sources,
    }
