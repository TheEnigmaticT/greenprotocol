"""P1 waste-prevention scoring regressions."""

from scoring.models import ChemicalInput
from scoring.p1_waste_prevention import score_p1


def test_benchmark_only_pmi_is_not_presented_as_a_procedure_comparison():
    """A benchmark cannot stand in for an unreported product mass or yield."""
    score = score_p1(
        chemicals=[
            ChemicalInput(
                name="acetonitrile",
                role="solvent",
                quantity="10 mL",
                quantity_g=7.86,
            )
        ],
        reaction_type="amide coupling",
        benchmark_pmi=25.0,
    )

    assert score.score == -1.0
    assert score.details["method"] == "benchmark_reference_only"
    assert score.details["product_mass_g"] is None
    assert score.details["yield_pct"] is None
    assert score.details["vs_benchmark"] is None
    assert "reference only" in score.details["_summary"].lower()
