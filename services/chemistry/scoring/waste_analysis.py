"""Structured waste analysis with an explicit waste/disposition boundary.

Parsed inputs, GHS flags, and process counts do not establish generated
waste, liquid phase, recovery, or final disposition. No measured waste or
disposition record enters the scoring contract, so this module never
reports an actual waste mass: it emits an ``availability`` block alongside
the source-grounded observations that remain reportable.

Contract summary:
  * ``summary.wasteImpactScore`` is always the -1 sentinel and
    ``summary.grade`` is always ``"INCOMPLETE"``; ``summary.confidence`` is
    ``"unavailable"``. A complete input inventory does not change this:
    inputs are not waste.
  * ``directWaste.*Kg`` and ``liquidBurden.*Kg`` are JSON ``null`` — never a
    numeric 0, never an input-derived estimate, never a fixed-fraction
    "discarded" guess.
  * ``observedInputInventory`` keeps the known input masses and their
    coverage labels, independently of any waste conclusion.
  * ``hazardSegments`` lists observed input hazard flags qualitatively
    (chemicals + counts); their ``totalKg`` is observed *input* mass, and is
    ``null`` whenever any contributor in that bucket lacks a usable mass.
  * Product-role chemicals are excluded from the input inventory and from
    the input hazard buckets (they are outputs; P4 scores their toxicity).
  * The ``availability`` block carries explicit missing-input reasons, the
    numeric convention (``wasteImpactScoreSentinel=-1``,
    ``nullKgMeansUnavailable=true``) and the reason no waste metric can be
    produced: ``input inventory is not measured waste/disposition``.
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
    is_product_role,
)


WASTE_IMPACT_SCORE_SENTINEL: int = -1
WASTE_GRADE_INCOMPLETE: str = "INCOMPLETE"
WASTE_CONFIDENCE_UNAVAILABLE: str = "unavailable"

#: Stated whenever an actual waste / disposition metric is reported as null.
WASTE_EVIDENCE_REASON: str = "input inventory is not measured waste/disposition"


# ── Legacy penalty helpers ──────────────────────────────────────────
#
# These helpers predate the waste/disposition evidence boundary and are
# retained for reference only. They are NOT wired into any returned metric:
# every penalty they compute is derived from input inventory, which is not
# evidence of waste. They must not be re-connected to the response until a
# measured waste/disposition record exists.

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
        if is_product_role(chem):
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
        if is_product_role(chem):
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
    """Compute a structured waste analysis with an explicit evidence boundary.

    The scoring contract carries no measured waste stream and no disposition
    record: input masses, H-codes and process counts describe what went in,
    never what was generated, discarded, recovered, or disposed of. Every
    actual waste metric is therefore reported as ``null`` and the summary
    stays INCOMPLETE / -1 / "unavailable" — including when the input
    inventory itself is complete and fully hazard-annotated.

    Args:
        chemicals: Parsed chemicals with quantities in kg.
        hcodes_map: Chemical name -> list of GHS H-codes.
        process_metrics: Optional dict with transfer_count, vessel_count,
            purification_count, wash_step_count from process complexity scoring.

    Returns:
        Dict matching the WasteAnalysis TypeScript interface shape, with:
          * ``availability`` block declaring missing-input reasons, the
            numeric convention, and why no waste metric can be produced,
          * ``summary.wasteImpactScore == -1``, ``summary.grade ==
            "INCOMPLETE"`` and ``summary.confidence == "unavailable"``,
          * ``directWaste.*Kg`` and ``liquidBurden.*Kg`` as JSON ``null``,
          * ``observedInputInventory`` preserving known input masses and
            their coverage,
          * ``hazardSegments`` listing observed input hazard flags
            qualitatively (chemicals + counts) with observed input mass.
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

    input_coverage_complete = mass_complete and hazard_complete

    buckets = bucket_hazard_chemicals(chemicals, hcodes_map)

    # ── Actual waste / disposition metrics ───────────────────────────
    # Inputs are not waste. Without a measured waste stream, a phase
    # observation, and a disposition record, every actual waste number
    # stays null — even with a complete, hazard-annotated input inventory.
    solvent_kg = None
    non_solvent_kg = None
    total_kg = None
    liquid_handled_kg = None
    liquid_discarded_kg = None
    waste_score = WASTE_IMPACT_SCORE_SENTINEL
    grade = WASTE_GRADE_INCOMPLETE
    confidence = WASTE_CONFIDENCE_UNAVAILABLE
    driver = f"Actual waste generation is unknown: {WASTE_EVIDENCE_REASON}."
    next_action = "Record measured waste streams and their final disposition to estimate waste."

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

    input_chemicals = [c for c in chemicals if not is_product_role(c)]
    if hazard_complete:
        hazard_coverage = "complete"
    elif any(hcodes_map.get(c.name) for c in input_chemicals):
        hazard_coverage = "partial"
    else:
        hazard_coverage = "unavailable"

    if input_coverage_complete:
        input_coverage = "complete"
    elif mass_complete or hazard_complete:
        input_coverage = "partial"
    else:
        input_coverage = "unavailable"

    availability = {
        "actualWasteMass": "unavailable",
        "liquidDisposition": "unavailable",
        "wasteImpactScoreSentinel": WASTE_IMPACT_SCORE_SENTINEL,
        "nullKgMeansUnavailable": True,
        "missingInputs": missing_inputs,
        "reason": WASTE_EVIDENCE_REASON,
        "massCoverage": inventory["massCoverage"],
        "hazardCoverage": hazard_coverage,
        "inputCoverage": input_coverage,
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
                "totalKg": data["totalKg"],  # observed input mass, or None per massCoverage
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
