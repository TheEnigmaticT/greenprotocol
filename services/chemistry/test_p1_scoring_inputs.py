"""Evidence-bound P1 PMI inputs."""

from scoring.models import ChemicalInput, ScoreProvenance
from scoring.p1_waste_prevention import score_p1


def chemical(name: str, role: str, mass_g: float | None) -> ChemicalInput:
    return ChemicalInput(name=name, role=role, quantity_g=mass_g)


def test_p1_excludes_declared_product_and_byproduct_from_input_mass() -> None:
    result = score_p1(
        chemicals=[
            chemical("substrate", "reactant", 8.0),
            chemical("ethanol", "solvent", 12.0),
            chemical("desired product", "product", 4.0),
            chemical("salt", "byproduct", 2.0),
        ],
        product_mass_g=4.0,
    )
    assert result.details["total_input_g"] == 20.0
    assert result.details["pmi"] == 5.0


def test_p1_rejects_empty_inventory_nonfinite_mass_and_impossible_product_mass() -> None:
    empty = score_p1(chemicals=[], product_mass_g=1.0)
    nonfinite = score_p1(chemicals=[chemical("substrate", "reactant", float("inf"))], product_mass_g=1.0)
    impossible = score_p1(chemicals=[chemical("substrate", "reactant", 2.0)], product_mass_g=3.0)

    for result in (empty, nonfinite, impossible):
        assert result.score == -1.0
        assert result.confidence is ScoreProvenance.UNAVAILABLE
    assert "no process inputs" in empty.details["error"].lower()
    assert nonfinite.details["missing_input_masses"] == ["substrate"]
    assert "greater than all process inputs" in impossible.details["error"].lower()


def test_p1_uses_only_explicit_product_mass_and_keeps_benchmark_reference_only() -> None:
    unavailable = score_p1(
        chemicals=[chemical("substrate", "reactant", 10.0)],
        yield_pct=80.0,
        yield_source="stated",
        benchmark_pmi=25.0,
    )
    assert unavailable.score == -1.0
    assert unavailable.details["method"] == "benchmark_reference_only"
    assert unavailable.details["pmi"] is None

    calculated = score_p1(
        chemicals=[chemical("substrate", "reactant", 8.0), chemical("solvent", "solvent", 12.0)],
        product_mass_g=4.0,
        yield_pct=80.0,
    )
    assert calculated.details["pmi"] == 5.0
    assert calculated.details["method"] == "declared_product_mass"
