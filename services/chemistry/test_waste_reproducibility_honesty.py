"""Waste-analysis reproducibility honesty regressions.

Strict RED tests scoped to services/chemistry/scoring/waste_analysis.py and
waste_helpers.py. These tests pin the contract that:

  * No synthetic mass contributes to authoritative waste-burden metrics.
  * Missing / nonpositive / nonfinite mass forces summary grade=INCOMPLETE,
    confidence="unavailable", wasteImpactScore=-1 and null kg fields.
  * Unknown hazard evidence (chemical absent from hcodes_map) is not
    silently discarded and does not grade the remaining subset complete.
  * Observed hazard flags remain visible qualitatively (chemical names +
    counts), but their summed quantities are not claimed when any flag's
    contributor has an unknown mass.
  * Response keys (directWaste, liquidBurden, hazardSegments,
    processBurden, summary) are preserved with null where the metric is
    unavailable, so the parent caller can decide on type updates.

Tests intentionally avoid asserting any fabricated totalWasteKg > 0
whenever coverage is incomplete. The complete-coverage case is included
only as a sanity anchor; it does not need to be RED first.
"""

from __future__ import annotations

import pytest

from scoring.models import ChemicalInput
from scoring.waste_analysis import compute_waste_analysis


# ── Helpers ────────────────────────────────────────────────────────


def _chem(name: str, *, role: str = "reagent", quantity_kg: float | None = None) -> ChemicalInput:
    return ChemicalInput(name=name, role=role, quantity_kg=quantity_kg)


# ── Mass availability contract ─────────────────────────────────────


def test_missing_mass_marks_summary_incomplete_and_unavailable():
    """Any chemical with quantity_kg=None forces INCOMPLETE/unavailable/-1."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("unmeasured_reagent", role="reagent"),  # quantity_kg=None
        ],
        hcodes_map={"acetonitrile": ["H225"]},
    )
    summary = analysis["summary"]
    assert summary["grade"] == "INCOMPLETE", (
        f"grade must be INCOMPLETE when any mass is missing, got {summary.get('grade')!r}"
    )
    assert summary["confidence"] == "unavailable", (
        f"confidence must be 'unavailable' on missing mass, got {summary.get('confidence')!r}"
    )
    assert summary["wasteImpactScore"] == -1, (
        f"wasteImpactScore must be the explicit -1 sentinel on missing mass, got {summary.get('wasteImpactScore')!r}"
    )

    # Unavailable kg fields are JSON null, never a numeric 0 masquerading as a measurement.
    assert analysis["directWaste"]["totalWasteKg"] is None
    assert analysis["directWaste"]["solventWasteKg"] is None
    assert analysis["directWaste"]["nonSolventWasteKg"] is None
    assert analysis["liquidBurden"]["totalLiquidHandledKg"] is None
    assert analysis["liquidBurden"]["totalLiquidDiscardedKg"] is None


def test_nonpositive_mass_marks_summary_incomplete():
    """Zero or negative quantity_kg is not a measurement — same INCOMPLETE path."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("zero_reagent", role="reagent", quantity_kg=0.0),
            _chem("negative_reagent", role="reagent", quantity_kg=-0.5),
        ],
        hcodes_map={"acetonitrile": ["H225"]},
    )
    assert analysis["summary"]["grade"] == "INCOMPLETE"
    assert analysis["summary"]["confidence"] == "unavailable"
    assert analysis["summary"]["wasteImpactScore"] == -1
    assert analysis["directWaste"]["totalWasteKg"] is None
    assert analysis["directWaste"]["solventWasteKg"] is None


def test_nonfinite_mass_marks_summary_incomplete():
    """NaN / +inf quantity_kg is not a measurement — same INCOMPLETE path."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("nan_reagent", role="reagent", quantity_kg=float("nan")),
            _chem("inf_reagent", role="reagent", quantity_kg=float("inf")),
        ],
        hcodes_map={"acetonitrile": ["H225"]},
    )
    assert analysis["summary"]["grade"] == "INCOMPLETE"
    assert analysis["summary"]["confidence"] == "unavailable"
    assert analysis["summary"]["wasteImpactScore"] == -1
    assert analysis["directWaste"]["totalWasteKg"] is None


# ── Unknown hazard evidence contract ───────────────────────────────


def test_unknown_hazard_lookup_does_not_grade_remaining_subset_complete():
    """A chemical absent from hcodes_map is not safety; remaining subset stays INCOMPLETE."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("unknown_lookup_reagent", role="reagent", quantity_kg=0.2),
        ],
        hcodes_map={"acetonitrile": ["H225"]},  # unknown_lookup_reagent has no lookup
    )
    # The unknown chemical must be named in the missing-input reasons,
    # never silently dropped from coverage.
    serialized = analysis.get("availability", {})
    missing_inputs = (
        serialized.get("missingInputs")
        or analysis.get("missingInputs")
        or []
    )
    names = {m.get("chemical") for m in missing_inputs if isinstance(m, dict)}
    assert "unknown_lookup_reagent" in names, (
        f"unknown hazard evidence must be surfaced explicitly, got {missing_inputs!r}"
    )
    assert analysis["summary"]["grade"] == "INCOMPLETE", (
        "Unknown hazard evidence must propagate INCOMPLETE; grading the "
        f"remaining subset as complete misrepresents coverage. Got {analysis['summary']['grade']!r}"
    )
    assert analysis["summary"]["confidence"] == "unavailable"


def test_empty_hcodes_list_is_not_verified_safety():
    """An empty hazard list means no evidence returned, not verified safety."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("unverified", role="reagent", quantity_kg=0.2),
        ],
        hcodes_map={"acetonitrile": ["H225"], "unverified": []},
    )
    serialized = analysis.get("availability", {})
    missing_inputs = (
        serialized.get("missingInputs")
        or analysis.get("missingInputs")
        or []
    )
    names = {m.get("chemical") for m in missing_inputs if isinstance(m, dict)}
    assert "unverified" in names, (
        f"empty hazard list must be surfaced as unavailable evidence, got {missing_inputs!r}"
    )
    assert analysis["summary"]["grade"] == "INCOMPLETE"


# ── Observed hazard flags remain visible qualitatively ─────────────


def test_observed_hazard_flags_still_reported_qualitatively_without_sums():
    """A flagged chemical with unknown mass stays visible, but its totalKg is not claimed."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("unmeasured_toxic", role="reagent"),  # flagged, no mass
        ],
        hcodes_map={
            "acetonitrile": ["H225"],
            "unmeasured_toxic": ["H300"],  # present → toxic flag is observed
        },
    )
    segs = analysis["hazardSegments"]
    toxic = next((s for s in segs if s["category"] == "toxic"), None)
    assert toxic is not None, "observed toxic flag must remain visible qualitatively"
    assert toxic["chemicalsCount"] == 1
    assert "unmeasured_toxic" in toxic["chemicals"]
    # Mass sum is not claimed when coverage on this bucket is incomplete.
    assert toxic["totalKg"] is None, (
        f"observed-flag segment must not claim a summed quantity, got totalKg={toxic['totalKg']!r}"
    )
    assert toxic.get("massCoverage") in {"partial", "unavailable"}


def test_complete_coverage_observed_flag_carries_summed_quantity():
    """When every flagged chemical has a usable mass, the segment totalKg is reported."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("known_toxic", role="reagent", quantity_kg=0.2),
        ],
        hcodes_map={"acetonitrile": ["H225"], "known_toxic": ["H300"]},
    )
    segs = analysis["hazardSegments"]
    toxic = next((s for s in segs if s["category"] == "toxic"), None)
    assert toxic is not None
    assert toxic["totalKg"] == pytest.approx(0.2, rel=1e-4)
    assert toxic.get("massCoverage") == "complete"


# ── Availability block / response-shape contract ───────────────────


def test_availability_block_carries_explicit_missing_input_reasons():
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("unmeasured", role="reagent"),
            _chem("unmeasured_toxic", role="reagent"),
        ],
        hcodes_map={
            "acetonitrile": ["H225"],
            "unmeasured_toxic": ["H300"],
            # 'unmeasured' is intentionally absent — a missing lookup.
        },
    )
    assert "availability" in analysis, "an availability block must be emitted"
    availability = analysis["availability"]
    missing_inputs = availability.get("missingInputs") or []
    # Each reason names the chemical, the input, and the reason.
    by_chem = {m.get("chemical"): m for m in missing_inputs if isinstance(m, dict)}
    assert "unmeasured" in by_chem, by_chem
    assert by_chem["unmeasured"].get("input") == "quantity_kg"
    assert by_chem["unmeasured"].get("reason") in {"missing_or_nonpositive", "missing_or_nonfinite"}


def test_response_keys_preserved_on_unavailable_path():
    """Even when unavailable, all parent-facing keys remain present (None for nulls)."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("unmeasured", role="reagent"),
        ],
        hcodes_map={"acetonitrile": ["H225"]},
    )
    for key in (
        "summary",
        "directWaste",
        "hazardSegments",
        "liquidBurden",
        "processBurden",
        "evidenceSources",
    ):
        assert key in analysis, f"missing preserved key: {key}"
    # Null sentinel, not 0, in unavailable kg fields.
    for field in (
        "totalWasteKg",
        "solventWasteKg",
        "nonSolventWasteKg",
    ):
        assert analysis["directWaste"][field] is None
    for field in (
        "totalLiquidHandledKg",
        "totalLiquidDiscardedKg",
    ):
        assert analysis["liquidBurden"][field] is None
    # processBurden counts are still observably authoritative.
    assert "purificationCount" in analysis["processBurden"]


def test_complete_input_coverage_does_not_establish_actual_waste_metrics():
    """Input inventory stays measurable; actual output/disposition stays unknown."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("solid", role="reagent", quantity_kg=0.2),
        ],
        hcodes_map={"acetonitrile": ["H225"], "solid": ["H300"]},
    )
    assert analysis["observedInputInventory"]["knownInputMassKg"] == pytest.approx(1.0, rel=1e-4)
    assert analysis["observedInputInventory"]["massCoverage"] == "complete"
    assert analysis["summary"]["grade"] == "INCOMPLETE"
    assert analysis["summary"]["wasteImpactScore"] == -1
    assert all(value is None for value in analysis["directWaste"].values())
    assert all(value is None for value in analysis["liquidBurden"].values())
    assert analysis["availability"]["actualWasteMass"] == "unavailable"


# ── Convenience: numeric convention declared ───────────────────────


def test_numeric_convention_documented_in_availability():
    """The availability block must declare the numeric convention used."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("unmeasured", role="reagent"),
        ],
        hcodes_map={"acetonitrile": ["H225"]},
    )
    availability = analysis.get("availability") or {}
    convention_keys = {
        "wasteImpactScoreSentinel",  # -1 means unavailable
        "nullKgMeansUnavailable",   # null kg means unavailable
    }
    # At least one of the convention declarations must be present.
    assert convention_keys & set(availability.keys()), (
        f"availability block must declare numeric convention; got keys {list(availability.keys())}"
    )
