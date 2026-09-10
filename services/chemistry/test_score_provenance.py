from scoring.p2_atom_economy import score_p2
from scoring.models import ScoreProvenance
import pytest
from smiles_extractor import _validate_smiles


def test_p2_unbalanced_reaction_is_unavailable_not_a_benchmark() -> None:
    score = score_p2("CCO>>CC")

    assert score.confidence is ScoreProvenance.UNAVAILABLE
    assert score.score == -1
    assert score.details["balanced"] is False


@pytest.mark.parametrize("reaction", [">>", "CCO>>", ">>CCO", "CCO>>CCO>>O"])
def test_p2_malformed_or_empty_sides_do_not_crash_or_get_a_normal_score(reaction):
    score = score_p2(reaction)
    assert score.confidence is ScoreProvenance.UNAVAILABLE
    assert score.score == -1


@pytest.mark.parametrize("index", [-1, 1])
def test_p2_invalid_product_selection_is_not_silently_replaced(index):
    score = score_p2("CCO>>CCO", desired_product_index=index)
    assert score.confidence is ScoreProvenance.UNAVAILABLE


def test_p2_requires_explicit_target_for_multiple_products():
    score = score_p2("CCO>>CC=O.[H][H]")
    assert score.confidence is ScoreProvenance.UNAVAILABLE
    assert "desired product" in score.details["error"].lower()
    selected = score_p2("CCO>>CC=O.[H][H]", desired_product_index=0)
    assert selected.confidence is ScoreProvenance.CALCULATED
    assert selected.details["balanced"] is True


def test_extractor_validates_atom_balance_not_just_parseable_molecules():
    valid, reason = _validate_smiles("CCO>>CC")
    assert valid is False
    assert "unbalanced" in reason
    assert _validate_smiles("CCO>>CC=O.[H][H]")[0] is True
