"""Boundary regressions: absent hazard evidence is not a hazard-free certificate."""
from scoring.models import ChemicalInput
from scoring.input_honesty import missing_hcodes_inputs
from scoring.p3_less_hazardous import score_p3
from scoring.p4_product_toxicity import score_p4


def test_empty_hazard_lookup_is_missing_evidence():
    chemicals = [ChemicalInput(name="unknown", quantity_g=1)]
    assert missing_hcodes_inputs(chemicals, {"unknown": []})


def test_product_without_hazard_evidence_is_not_a_zero_score():
    product = ChemicalInput(name="declared but unresolved product", role="product")
    score = score_p4([product], {product.name: []})
    assert score.score == -1
    assert score.confidence.value == "unavailable"


def test_no_chemical_inventory_cannot_establish_zero_health_hazard():
    assert score_p3([], {}).score == -1


def test_explicit_solvent_missing_curated_evidence_is_unavailable(monkeypatch):
    import scoring.p5_safer_solvents as p5
    monkeypatch.setattr(p5, "lookup_solvent", lambda _name: None)
    chemical = ChemicalInput(name="unlisted solvent", role="solvent", quantity_g=5)
    result = p5.score_p5([chemical])
    assert result.score == -1
    assert result.confidence.value == "unavailable"


def test_nonempty_evidence_with_no_relevant_health_codes_can_score_zero():
    # Synthetic code fixture: evidence exists, but only physical hazard is supplied.
    chemical = ChemicalInput(name="fixture", quantity_g=1)
    assert score_p3([chemical], {"fixture": ["H225"]}).score == 0
