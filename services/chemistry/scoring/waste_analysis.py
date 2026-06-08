"""Structured waste analysis module.

Computes a top-level waste impact score and detailed breakdown from
parsed chemical data. All scoring is deterministic — no LLM calls.

Score formula (0-10, lower is greener):
  base = 0
  + solvent_mass_penalty   (0-3): penalises heavy solvent use
  + hazard_penalty         (0-3): penalises toxic/CMR chemicals
  + liquid_burden_penalty  (0-2): penalises high liquid throughput
  + process_burden_penalty (0-2): penalises complex purification

Weight choices are documented inline and will evolve as we validate
against benchmark protocols.
"""

from __future__ import annotations
from typing import Sequence

from .models import ChemicalInput
from .waste_helpers import (
    safe_kg,
    sum_solvent_mass_kg,
    sum_non_solvent_mass_kg,
    sum_liquid_mass_kg,
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

    # Direct waste
    solvent_kg = sum_solvent_mass_kg(chemicals)
    non_solvent_kg = sum_non_solvent_mass_kg(chemicals)
    total_kg = solvent_kg + non_solvent_kg

    # Liquid burden
    liquid_handled_kg = sum_liquid_mass_kg(chemicals)
    # Heuristic: ~60% of liquid handled ends up discarded (washes, extractions)
    liquid_discarded_kg = liquid_handled_kg * 0.6

    # Hazard bucketing
    buckets = bucket_hazard_chemicals(chemicals, hcodes_map)

    # Sub-scores
    sp = _solvent_penalty(solvent_kg, total_kg)
    hp = _hazard_penalty(buckets)
    lp = _liquid_burden_penalty(liquid_handled_kg)
    pp = _process_burden_penalty(purification_count, wash_step_count, transfer_count)

    waste_score = round(min(sp + hp + lp + pp, 10.0), 1)
    grade = _grade(waste_score)
    worst = _worst_category(sp, hp, lp, pp)
    driver = _identify_primary_driver(worst, buckets)
    next_action = _best_next_action(worst, buckets)

    # Determine confidence
    has_quantities = any(safe_kg(c) > 0 for c in chemicals)
    has_hcodes = any(len(codes) > 0 for codes in hcodes_map.values())
    if has_quantities and has_hcodes:
        confidence = "calculated"
    elif has_quantities or has_hcodes:
        confidence = "partial"
    else:
        confidence = "estimated"

    # Evidence sources
    sources = []
    if has_quantities:
        sources.append("PubChem/RDKit unit conversion")
    if has_hcodes:
        sources.append("GHS PUG-View H-codes")
    if process_metrics:
        sources.append("Process complexity analysis")

    return {
        "summary": {
            "wasteImpactScore": waste_score,
            "grade": grade,
            "primaryDriver": driver,
            "bestNextAction": next_action,
            "confidence": confidence,
        },
        "directWaste": {
            "totalWasteKg": round(total_kg, 4),
            "solventWasteKg": round(solvent_kg, 4),
            "nonSolventWasteKg": round(non_solvent_kg, 4),
        },
        "hazardSegments": [
            {
                "category": cat,
                "totalKg": round(data["totalKg"], 4),
                "chemicalsCount": data["count"],
                "chemicals": data["chemicals"],
            }
            for cat, data in buckets.items()
            if data["count"] > 0
        ],
        "liquidBurden": {
            "totalLiquidHandledKg": round(liquid_handled_kg, 4),
            "totalLiquidDiscardedKg": round(liquid_discarded_kg, 4),
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
