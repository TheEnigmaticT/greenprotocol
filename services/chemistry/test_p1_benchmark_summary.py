"""Regression for benchmark-only P1 summaries without a derived product mass."""

from scoring.models import ChemicalInput
from scoring.p1_waste_prevention import score_p1


def test_p1_benchmark_only_summary_does_not_round_missing_product_mass():
    score = score_p1(
        chemicals=[ChemicalInput(name="Solvent", role="solvent", quantity_g=25.0)],
        benchmark_pmi=50.0,
    )

    assert score.details["method"] == "benchmark_pmi_only"
    assert score.details["product_mass_g"] is None
    assert score.details["_summary"] == "Benchmark-only PMI = 50.0; product mass was not derived from this protocol."
