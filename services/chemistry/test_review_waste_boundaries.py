"""Reviewer B3/B4: a known input inventory never proves actual waste.

Strict RED tests for ``services/chemistry/scoring/waste_analysis.py`` and
``services/chemistry/scoring/waste_helpers.py``.

The scoring pipeline has no actual waste / disposition DTO: nothing in a
request carries a waste stream, a phase, a recovery rate, or a disposal
route. A protocol that states every input mass and every H-code therefore
still proves nothing about actual waste generation or liquid disposition.
These tests pin that boundary:

  * actual waste mass, liquid burden and the waste impact score stay
    unavailable (``null`` kg, score ``-1``, grade ``INCOMPLETE``,
    confidence ``unavailable``) even with complete input coverage;
  * the known input inventory survives as an independent observation with
    its own coverage labels;
  * hazard segments keep observed *input* mass qualitatively and never
    claim a summed mass when a flagged input has no usable mass;
  * product roles (and their synonyms) are excluded consistently from the
    observed input mass and from the input hazard buckets;
  * no arbitrary discard fraction reappears anywhere in the waste module.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from scoring.models import ChemicalInput
from scoring.waste_analysis import compute_waste_analysis


WASTE_MODULE = Path(__file__).resolve().parent / "scoring" / "waste_analysis.py"

UNAVAILABLE_REASON = "input inventory is not measured waste/disposition"

PRODUCT_ROLE_SYNONYMS = (
    "product",
    "desired product",
    "target",
    "intermediate",
    "final product",
    "main product",
)


# ── Helpers ────────────────────────────────────────────────────────


def _chem(name: str, *, role: str = "reagent", quantity_kg: float | None = None) -> ChemicalInput:
    return ChemicalInput(name=name, role=role, quantity_kg=quantity_kg)


def _segment(analysis: dict, category: str) -> dict | None:
    return next((s for s in analysis["hazardSegments"] if s["category"] == category), None)


# ── B3: complete input coverage still proves no waste ───────────────


def test_complete_input_coverage_cannot_produce_actual_waste_metrics():
    """Every input mass and H-code known ⇒ still no actual waste, no score."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("solid_reagent", role="reagent", quantity_kg=0.2),
        ],
        hcodes_map={"acetonitrile": ["H225"], "solid_reagent": ["H300"]},
    )
    summary = analysis["summary"]
    assert summary["wasteImpactScore"] == -1, (
        "known inputs are not a waste measurement; score must stay the -1 sentinel, "
        f"got {summary['wasteImpactScore']!r}"
    )
    assert summary["grade"] == "INCOMPLETE", (
        f"grade must stay INCOMPLETE without waste evidence, got {summary['grade']!r}"
    )
    assert summary["confidence"] == "unavailable", (
        f"confidence must stay 'unavailable', got {summary['confidence']!r}"
    )
    for field in ("totalWasteKg", "solventWasteKg", "nonSolventWasteKg"):
        assert analysis["directWaste"][field] is None, (
            f"directWaste.{field} must be null: no waste stream was measured"
        )
    for field in ("totalLiquidHandledKg", "totalLiquidDiscardedKg"):
        assert analysis["liquidBurden"][field] is None, (
            f"liquidBurden.{field} must be null: no liquid phase or disposition was measured"
        )
    availability = analysis["availability"]
    assert availability["actualWasteMass"] == "unavailable"
    assert availability["liquidDisposition"] == "unavailable"
    assert UNAVAILABLE_REASON in availability["reason"], (
        f"availability must state why the waste metrics are null, got {availability['reason']!r}"
    )


def test_no_arbitrary_discard_fraction_is_applied():
    """No 'handled × fraction' discard estimate may reappear in the module."""
    source = WASTE_MODULE.read_text(encoding="utf-8")
    fractions = re.findall(
        r"discard[a-z_]*\s*=\s*[^\n]*\*\s*0\.\d+", source, flags=re.IGNORECASE
    )
    assert not fractions, (
        f"an arbitrary discard fraction reappeared in the waste module: {fractions}"
    )
    analysis = compute_waste_analysis(
        chemicals=[_chem("acetonitrile", role="solvent", quantity_kg=0.8)],
        hcodes_map={"acetonitrile": ["H225"]},
    )
    assert analysis["liquidBurden"]["totalLiquidDiscardedKg"] is None
    assert analysis["liquidBurden"]["totalLiquidHandledKg"] is None


def test_solvent_role_does_not_assert_liquid_phase():
    """A 'solvent' role is a use label, not proof of liquid phase/handling."""
    analysis = compute_waste_analysis(
        chemicals=[_chem("acetonitrile", role="solvent", quantity_kg=0.8)],
        hcodes_map={"acetonitrile": ["H225"]},
    )
    assert analysis["liquidBurden"]["totalLiquidHandledKg"] is None
    assert analysis["liquidBurden"]["totalLiquidDiscardedKg"] is None
    # The mass is still an observed input mass.
    assert analysis["observedInputInventory"]["knownInputMassKg"] == pytest.approx(0.8, rel=1e-4)


# ── Observed input inventory is preserved independently ─────────────


def test_known_input_inventory_is_preserved_independently_of_waste():
    """Positive known input mass survives; the waste conclusion does not."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("solid_reagent", role="reagent", quantity_kg=0.2),
        ],
        hcodes_map={"acetonitrile": ["H225"], "solid_reagent": ["H300"]},
    )
    inventory = analysis["observedInputInventory"]
    assert inventory["knownInputMassKg"] == pytest.approx(1.0, rel=1e-4), (
        "known input mass is an inventory observation and must not be dropped"
    )
    assert inventory["knownMassChemicalCount"] == 2
    assert inventory["chemicalsWithUnknownMassCount"] == 0
    assert inventory["massCoverage"] == "complete"
    # ... but the waste conclusion stays unavailable.
    assert analysis["directWaste"]["totalWasteKg"] is None
    assert analysis["summary"]["wasteImpactScore"] == -1


def test_product_roles_excluded_from_observed_input_mass():
    """Product roles and their synonyms are outputs, not inputs."""
    chemicals = [_chem("acetonitrile", role="solvent", quantity_kg=0.8)]
    for index, role in enumerate(PRODUCT_ROLE_SYNONYMS):
        chemicals.append(_chem(f"product_{index}", role=role, quantity_kg=5.0 + index))
    hcodes_map = {"acetonitrile": ["H225"]}
    for index in range(len(PRODUCT_ROLE_SYNONYMS)):
        hcodes_map[f"product_{index}"] = ["H301", "H350"]

    analysis = compute_waste_analysis(chemicals=chemicals, hcodes_map=hcodes_map)
    inventory = analysis["observedInputInventory"]
    assert inventory["knownInputMassKg"] == pytest.approx(0.8, rel=1e-4), (
        "product-role masses must not enter the observed input inventory"
    )
    assert inventory["knownMassChemicalCount"] == 1
    assert inventory["chemicalsWithUnknownMassCount"] == 0
    assert inventory["massCoverage"] == "complete"


def test_product_role_without_mass_does_not_degrade_input_coverage():
    """An unquantified product must not make the input coverage partial."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("unquantified_product", role="product", quantity_kg=None),
        ],
        hcodes_map={"acetonitrile": ["H225"], "unquantified_product": []},
    )
    inventory = analysis["observedInputInventory"]
    assert inventory["massCoverage"] == "complete"
    assert inventory["chemicalsWithUnknownMassCount"] == 0


def test_product_roles_excluded_from_hazard_input_buckets():
    """Product hazard belongs to P4; the input hazard buckets must exclude it."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("toxic_product", role="desired product", quantity_kg=2.0),
        ],
        hcodes_map={"acetonitrile": ["H225"], "toxic_product": ["H301", "H350"]},
    )
    names = {name for seg in analysis["hazardSegments"] for name in seg["chemicals"]}
    assert "toxic_product" not in names, (
        "a product must not be reported as a hazardous input, got "
        f"{sorted(names)!r}"
    )
    assert _segment(analysis, "toxic") is None
    assert _segment(analysis, "cmr") is None
    assert "acetonitrile" in names, "genuine inputs must still be visible"


# ── Hazard segments stay qualitative observations of inputs ─────────


def test_hazard_segment_keeps_observed_input_mass():
    """A fully measured flagged input keeps its observed input mass."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("known_toxic", role="reagent", quantity_kg=0.2),
        ],
        hcodes_map={"acetonitrile": ["H225"], "known_toxic": ["H300"]},
    )
    toxic = _segment(analysis, "toxic")
    assert toxic is not None
    assert toxic["totalKg"] == pytest.approx(0.2, rel=1e-4)
    assert toxic["massCoverage"] == "complete"
    assert toxic["chemicalsCount"] == 1


def test_partial_hazard_bucket_mass_stays_null():
    """A flagged input without a usable mass must not produce a summed mass."""
    analysis = compute_waste_analysis(
        chemicals=[
            _chem("acetonitrile", role="solvent", quantity_kg=0.8),
            _chem("unmeasured_toxic", role="reagent", quantity_kg=None),
        ],
        hcodes_map={"acetonitrile": ["H225"], "unmeasured_toxic": ["H300"]},
    )
    toxic = _segment(analysis, "toxic")
    assert toxic is not None
    assert toxic["totalKg"] is None, (
        f"partial hazard bucket must not claim a mass, got {toxic['totalKg']!r}"
    )
    assert toxic["massCoverage"] in {"partial", "unavailable"}
    assert toxic["chemicalsCount"] == 1


# ── Response shape preserved ───────────────────────────────────────


def test_response_shape_preserved_on_unavailable_path():
    """All parent-facing keys stay present, with nulls where unavailable."""
    analysis = compute_waste_analysis(
        chemicals=[_chem("acetonitrile", role="solvent", quantity_kg=0.8)],
        hcodes_map={"acetonitrile": ["H225"]},
    )
    for key in (
        "availability",
        "summary",
        "observedInputInventory",
        "directWaste",
        "hazardSegments",
        "liquidBurden",
        "processBurden",
        "evidenceSources",
    ):
        assert key in analysis, f"missing preserved key: {key}"
    for field in ("totalWasteKg", "solventWasteKg", "nonSolventWasteKg"):
        assert analysis["directWaste"][field] is None
    for field in ("totalLiquidHandledKg", "totalLiquidDiscardedKg"):
        assert analysis["liquidBurden"][field] is None
    assert "purificationCount" in analysis["processBurden"]
