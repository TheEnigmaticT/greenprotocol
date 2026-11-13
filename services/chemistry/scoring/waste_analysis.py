"""Structured waste analysis with explicit availability boundary.

Parsed inputs, GHS flags, and process counts do not establish generated
waste, liquid phase, recovery, or final disposition. Until a protocol
supplies those data, this module emits an ``availability`` block alongside
the source-grounded observations that remain reportable.

Contract summary:
  * ``summary.wasteImpactScore`` is -1 (sentinel) when any mass or hazard
    evidence is unavailable; otherwise it is the deterministic 0–10 score.
  * ``summary.grade`` is ``"INCOMPLETE"`` on the same condition;
    ``summary.confidence`` is ``"unavailable"`` (string-compatible).
  * ``directWaste.*Kg`` and ``liquidBurden.*Kg`` are JSON ``null`` when
    coverage is incomplete — never a numeric 0 masquerading as a measurement.
  * ``hazardSegments`` still lists observed hazard flags qualitatively
    (chemicals + counts) but their ``totalKg`` is ``null`` whenever any
    contributor in that bucket has missing/nonpositive/nonfinite mass.
  * The ``availability`` block carries explicit missing-input reasons and
    declares the numeric convention (``wasteImpactScoreSentinel=-1``,
    ``nullKgMeansUnavailable=true``).
"""

from __future__ import annotations
import math
from typing import Sequence

from .models import ChemicalInput
from .input_honesty import finite_positive_mass, missing_mass_inputs, missing_hcodes_inputs
from .waste_helpers import (
    finite_positive_kg,
    observed_input_inventory,
    bucket_hazard_chemicals,
)


WASTE_IMPACT_SCORE_SENTINEL: int = -1
WASTE_GRADE_INCOMPLETE: str = "INCOMPLETE"
WASTE_CONFIDENCE_UNAVAILABLE: str = "unavailable"


# ── Grade thresholds ─────────────────────────────────────────────

def _grade(score: float) -> str:
    """Convert a 0-10 score to letter grade; non-numeric → INCOMPLETE."""
    if not math.isfinite(score) or score < 0:
        return WASTE_GRADE_INCOMPLETE
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
    frac_score = min(fraction * 3.0, 3.0)
    abs_bump = min(solvent_kg / 2.0, 1.0)
    return min((frac_score + abs_bump) / 2.0, 3.0)


def _hazard_penalty(buckets: dict[str, dict]) -> float:
    """0-3 penalty based on hazardous chemical presence and known mass."""
    score = 0.0
    if buckets["cmr"]["count"] > 0:
        score += 1.5
    if buckets["toxic"]["count"] > 0 and buckets["toxic"].get("totalKg") is not None:
        score += min(buckets["toxic"]["totalKg"] * 1.0, 1.0)
    if buckets["environmental"]["count"] > 0:
        score += 0.5
    return min(score, 3.0)


def _liquid_burden_penalty(liquid_kg: float) -> float:
    """0-2 penalty for total liquid throughput."""
    return min(liquid_kg / 2.0, 2.0)


def _process_burden_penalty(
    purification_count: int,
    wash_step_count: int,
    transfer_count: int,
) -> float:
    """0-2 penalty for process complexity related to waste."""
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
    return "Telescope or one-pot the purification-heavy steps to reduce cleanup waste."


# ── Availability helpers ──────────────────────────────────────────

def _missing_mass_reasons(chemicals: list[ChemicalInput]) -> list[dict[str, str]]:
    """Describe every input chemical whose quantity_kg is missing/nonpositive/nonfinite."""
    reasons: list[dict[str, str]] = []
    for chem in chemicals:
        role = (chem.role or "").lower().strip()
        if role == "product":
            continue
        kg = chem.quantity_kg
        if kg is None:
            reasons.append({"chemical": chem.name, "input": "quantity_kg", "reason": "missing_or_nonpositive"})
            continue
        if isinstance(kg, float) and not math.isfinite(kg):
            reasons.append({"chemical": chem.name, "input": "quantity_kg", "reason": "missing_or_nonfinite"})
            continue
        if kg <= 0:
            reasons.append({"chemical": chem.name, "input": "quantity_kg", "reason": "missing_or_nonpositive"})
    return reasons


def _missing_hazard_reasons(
    chemicals: list[ChemicalInput],
    hcodes_map: dict[str, list[str]],
) -> list[dict[str, str]]:
    """Surface chemicals absent from hcodes_map; absent lookup ≠ verified safety.

    An empty hazard list (looked up but empty) is also surfaced: a present
    lookup with no H-codes is not proof of a hazard-free substance.
    """
    reasons: list[dict[str, str]] = []
    for chem in chemicals:
        role = (chem.role or "").lower().strip()
        if role == "product":
            continue
        if chem.name not in hcodes_map:
            reasons.append({"chemical": chem.name, "input": "hcodes", "reason": "unavailable_lookup"})
        elif not hcodes_map[chem.name]:
            reasons.append({"chemical": chem.name, "input": "hcodes", "reason": "empty_lookup"})
    return reasons


# ── Main entry point ─────────────────────────────────────────────

def compute_waste_analysis(
    chemicals: Sequence[ChemicalInput],
    hcodes_map: dict[str, list[str]],
    process_metrics: dict | None = None,
) -> dict:
    """Compute a full structured waste analysis with explicit availability boundary.

    Args:
        chemicals: Parsed chemicals with quantities in kg.
        hcodes_map: Chemical name -> list of GHS H-codes.
        process_metrics: Optional dict with transfer_count, vessel_count,
            purification_count, wash_step_count from process complexity scoring.

    Returns:
        Dict matching the WasteAnalysis TypeScript interface shape, with:
          * ``availability`` block declaring missing-input reasons and the
            numeric convention,
          * ``summary.wasteImpactScore == -1`` and ``summary.grade ==
            "INCOMPLETE"`` whenever mass or hazard evidence is incomplete,
          * ``directWaste.*Kg`` and ``liquidBurden.*Kg`` as JSON ``null``
            when their underlying metric is unavailable,
          * ``hazardSegments`` listing observed hazard flags qualitatively
            (chemicals + counts) even when the bucket's totalKg is null.
    """
    pm = process_metrics or {}
    transfer_count = pm.get("transfer_count", 0)
    vessel_count = pm.get("vessel_count", 0)
    purification_count = pm.get("purification_count", 0)
    wash_step_count = pm.get("wash_step_count", 0)
    workflow_complexity = pm.get("workflow_complexity", 0)

    inventory = observed_input_inventory(chemicals)
    mass_complete = inventory["massCoverage"] == "complete"

    missing_mass = _missing_mass_reasons(list(chemicals))
    missing_hazard = _missing_hazard_reasons(list(chemicals), hcodes_map)
    hazard_complete = not missing_hazard

    coverage_complete = mass_complete and hazard_complete

    buckets = bucket_hazard_chemicals(chemicals, hcodes_map)

    # Sub-scores: only meaningful when coverage is complete; otherwise we
    # leave the penalty path quiet so the sentinel below carries the load.
    if coverage_complete:
        # Recompute authoritative kg totals from the actually-usable masses.
        solvent_kg = sum(
            finite_positive_kg(c) or 0.0
            for c in chemicals
            if (c.role or "").lower().strip() in {"solvent", "co-solvent", "wash solvent", "extraction solvent"}
        )
        non_solvent_kg = sum(
            finite_positive_kg(c) or 0.0
            for c in chemicals
            if (c.role or "").lower().strip() not in {"product", "solvent", "co-solvent", "wash solvent", "extraction solvent"}
        )
        total_kg = round(solvent_kg + non_solvent_kg, 4)

        liquid_handled_kg = sum(
            finite_positive_kg(c) or 0.0
            for c in chemicals
            if (c.role or "").lower().strip() in {"solvent", "co-solvent", "wash solvent", "extraction solvent"}
        )
        liquid_discarded_kg = round(liquid_handled_kg * 0.6, 4)

        sp = _solvent_penalty(solvent_kg, total_kg)
        hp = _hazard_penalty(buckets)
        lp = _liquid_burden_penalty(liquid_handled_kg)
        pp = _process_burden_penalty(purification_count, wash_step_count, transfer_count)

        waste_score = round(min(sp + hp + lp + pp, 10.0), 1)
        grade = _grade(waste_score)
        worst = _worst_category(sp, hp, lp, pp)
        driver = _identify_primary_driver(worst, buckets)
        next_action = _best_next_action(worst, buckets)
        confidence = "calculated"
    else:
        solvent_kg = None
        non_solvent_kg = None
        total_kg = None
        liquid_handled_kg = None
        liquid_discarded_kg = None
        waste_score = WASTE_IMPACT_SCORE_SENTINEL
        grade = WASTE_GRADE_INCOMPLETE
        worst = "unknown"
        driver = "Actual waste generation is unknown: required inputs are unavailable."
        next_action = "Record waste streams and disposition to estimate waste."
        confidence = WASTE_CONFIDENCE_UNAVAILABLE

    # Evidence sources — list only what we can ground.
    sources: list[str] = []
    if inventory["knownMassChemicalCount"] > 0:
        sources.append("PubChem/RDKit unit conversion")
    if any(len(codes) > 0 for codes in hcodes_map.values()):
        sources.append("GHS PUG-View H-codes")
    if process_metrics:
        sources.append("Process complexity analysis")

    # Dedupe by chemical name, keeping the first reason we recorded for each
    # chemical so a chemical missing both mass and hcodes doesn't appear twice.
    # Mass reasons take priority over hazard reasons: a chemical with no
    # measurable mass has no authority for any waste or hazard summation, so
    # the mass gap is the more fundamental missing-input reason.
    missing_inputs: list[dict[str, str]] = []
    seen: set[str] = set()
    for entry in [*missing_mass, *missing_hazard]:
        name = entry.get("chemical")
        if not name or name in seen:
            continue
        seen.add(name)
        missing_inputs.append(entry)

    availability = {
        "actualWasteMass": "available" if coverage_complete else "unavailable",
        "liquidDisposition": "available" if coverage_complete else "unavailable",
        "wasteImpactScoreSentinel": WASTE_IMPACT_SCORE_SENTINEL,
        "nullKgMeansUnavailable": True,
        "missingInputs": missing_inputs,
        "reason": (
            "Mass and hazard evidence cover every evaluated input."
            if coverage_complete
            else "Actual waste generation and liquid disposition were not reported in the submitted protocol; required mass or hazard inputs are unavailable."
        ),
        "massCoverage": inventory["massCoverage"],
        "hazardCoverage": "complete" if hazard_complete else ("partial" if any(hcodes_map.get(c.name) for c in chemicals) else "unavailable"),
    }

    return {
        "availability": availability,
        "summary": {
            "wasteImpactScore": waste_score,
            "grade": grade,
            "primaryDriver": driver,
            "bestNextAction": next_action,
            "confidence": confidence,
        },
        "observedInputInventory": inventory,
        "directWaste": {
            "totalWasteKg": total_kg,
            "solventWasteKg": solvent_kg,
            "nonSolventWasteKg": non_solvent_kg,
        },
        "hazardSegments": [
            {
                "category": cat,
                "totalKg": data["totalKg"],  # already rounded or None per massCoverage
                "chemicalsCount": data["count"],
                "chemicals": data["chemicals"],
                "massCoverage": data["massCoverage"],
            }
            for cat, data in buckets.items()
            if data["count"] > 0
        ],
        "liquidBurden": {
            "totalLiquidHandledKg": liquid_handled_kg,
            "totalLiquidDiscardedKg": liquid_discarded_kg,
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
