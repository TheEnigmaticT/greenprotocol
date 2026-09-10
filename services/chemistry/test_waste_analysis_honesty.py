"""Waste-analysis availability boundary regressions."""

from scoring.models import ChemicalInput
from scoring.waste_analysis import compute_waste_analysis


def test_observed_input_inventory_is_not_reported_as_actual_waste_or_liquid_discard():
    analysis = compute_waste_analysis(
        chemicals=[
            ChemicalInput(name="product", role="product", quantity_kg=0.4),
            ChemicalInput(name="acetonitrile", role="solvent", quantity_kg=0.8),
            ChemicalInput(name="solid reagent", role="reagent", quantity_kg=0.2),
            ChemicalInput(name="unmeasured reagent", role="reagent"),
        ],
        hcodes_map={"acetonitrile": ["H225"], "solid reagent": ["H300"]},
        process_metrics={"transfer_count": 2, "purification_count": 1},
    )

    assert analysis["version"] == "waste-analysis/v2"
    assert analysis["availability"]["actualWasteMass"] == "unavailable"
    assert analysis["availability"]["liquidDisposition"] == "unavailable"
    assert analysis["summary"]["confidence"] == "unavailable"
    assert analysis["summary"]["wasteImpactScore"] == -1
    assert analysis["summary"]["grade"] == "unavailable"

    inventory = analysis["observedInputInventory"]
    assert inventory["massCoverage"] == "partial"
    assert inventory["knownInputMassKg"] == 1.0
    assert inventory["knownMassChemicalCount"] == 2
    assert inventory["chemicalsWithUnknownMassCount"] == 1

    assert analysis["directWaste"] == {
        "totalWasteKg": None,
        "solventWasteKg": None,
        "nonSolventWasteKg": None,
    }
    assert analysis["liquidBurden"] == {
        "totalLiquidHandledKg": None,
        "totalLiquidDiscardedKg": None,
    }
    assert analysis["hazardSegments"] == [
        {
            "category": "toxic",
            "totalKg": 0.2,
            "chemicalsCount": 1,
            "chemicals": ["solid reagent"],
            "massCoverage": "complete",
        },
        {
            "category": "flammable",
            "totalKg": 0.8,
            "chemicalsCount": 1,
            "chemicals": ["acetonitrile"],
            "massCoverage": "complete",
        },
    ]
    assert analysis["processBurden"]["purificationCount"] == 1
    assert "Actual waste generation and liquid disposition were not reported" in analysis["availability"]["reason"]


def test_hazard_flags_remain_visible_when_their_inventory_mass_is_unknown():
    analysis = compute_waste_analysis(
        chemicals=[ChemicalInput(name="unmeasured toxic", role="reagent")],
        hcodes_map={"unmeasured toxic": ["H300"]},
    )

    assert analysis["hazardSegments"] == [{
        "category": "toxic",
        "totalKg": None,
        "chemicalsCount": 1,
        "chemicals": ["unmeasured toxic"],
        "massCoverage": "unavailable",
    }]
    assert analysis["observedInputInventory"]["knownInputMassKg"] is None
    assert analysis["observedInputInventory"]["massCoverage"] == "unavailable"
