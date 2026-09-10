"""Regression coverage for honest non-P1 deterministic scoring inputs."""

import math

import pytest

from scoring.models import ChemicalInput, ScoreProvenance
from scoring.p3_less_hazardous import score_p3
from scoring.p4_product_toxicity import score_p4
from scoring.p5_safer_solvents import score_p5
from scoring.p7_renewable_feedstocks import score_p7
from scoring.p9_catalysis import score_p9
from scoring.p10_degradation import score_p10
from scoring.p12_accident_prevention import score_p12


@pytest.mark.parametrize(
    ("scorer", "chemicals", "kwargs"),
    [
        (score_p3, [ChemicalInput(name="hazard", role="reagent")], {"hcodes_map": {"hazard": ["H300"]}}),
        (score_p5, [ChemicalInput(name="water", role="solvent")], {}),
        (score_p7, [ChemicalInput(name="water", role="solvent")], {}),
        (score_p9, [ChemicalInput(name="catalyst", role="catalyst")], {}),
        (score_p10, [ChemicalInput(name="hazard", role="reagent")], {"hcodes_map": {"hazard": ["H410"]}}),
        (score_p12, [ChemicalInput(name="hazard", role="reagent")], {"hcodes_map": {"hazard": ["H225"]}}),
    ],
)
def test_mass_weighted_principles_are_unavailable_without_a_finite_positive_mass(scorer, chemicals, kwargs):
    result = scorer(chemicals, **kwargs)

    assert result.score == -1.0
    assert result.normalized == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert result.details["missing_inputs"] == [{"chemical": chemicals[0].name, "input": "quantity_g", "reason": "missing_or_nonpositive"}]
    assert result.details["provenance"] == "unavailable: mass-weighted calculation requires finite positive quantity_g for every evaluated chemical"


@pytest.mark.parametrize("invalid_mass", [0, -1, math.inf, math.nan])
def test_p7_rejects_nonpositive_and_nonfinite_mass_without_substituting_a_default(invalid_mass):
    result = score_p7([ChemicalInput(name="water", role="solvent", quantity_g=invalid_mass)])

    assert result.score == -1.0
    assert result.details["missing_inputs"][0]["input"] == "quantity_g"


@pytest.mark.parametrize(
    ("scorer", "chemicals", "kwargs"),
    [
        (score_p3, [ChemicalInput(name="unresolved", role="reagent", quantity_g=1)], {"hcodes_map": {}}),
        (score_p4, [ChemicalInput(name="unresolved", role="product")], {"hcodes_map": {}}),
        (score_p10, [ChemicalInput(name="unresolved", role="reagent", quantity_g=1)], {"hcodes_map": {}}),
        (score_p12, [ChemicalInput(name="unresolved", role="reagent", quantity_g=1)], {"hcodes_map": {}}),
    ],
)
def test_missing_ghs_data_is_unavailable_not_a_zero_hazard_score(scorer, chemicals, kwargs):
    result = scorer(chemicals, **kwargs)

    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert result.details["missing_inputs"] == [{"chemical": "unresolved", "input": "hcodes", "reason": "unavailable"}]
    assert result.details["provenance"] == "unavailable: GHS hazard data is required for every evaluated chemical"


def test_p5_unknown_chem21_classification_is_unavailable_not_assumed_problematic(monkeypatch):
    monkeypatch.setattr("scoring.p5_safer_solvents.lookup_solvent", lambda _: None)

    result = score_p5([ChemicalInput(name="unlisted solvent", role="solvent", quantity_g=1)])

    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert result.details["missing_inputs"] == [{"chemical": "unlisted solvent", "input": "chem21_classification", "reason": "unavailable"}]


def test_p7_unknown_feedstock_origin_is_unavailable_not_treated_as_petroleum():
    result = score_p7([ChemicalInput(name="unclassified feedstock", role="reagent", quantity_g=1)])

    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert result.details["missing_inputs"] == [{"chemical": "unclassified feedstock", "input": "renewable_classification", "reason": "unavailable"}]


def test_complete_known_inputs_keep_existing_mass_weighted_scores(monkeypatch):
    from chem21 import SolventEntry

    classifications = {
        "water": SolventEntry("water", "recommended", 0, 0, 0, 0),
        "dmf": SolventEntry("dmf", "hazardous", 0, 0, 0, 0),
    }
    monkeypatch.setattr("scoring.p5_safer_solvents.lookup_solvent", classifications.get)

    assert score_p3(
        [ChemicalInput(name="acute", role="reagent", quantity_g=1), ChemicalInput(name="none", role="reagent", quantity_g=9)],
        {"acute": ["H300"], "none": []},
    ).score == 1.0
    assert score_p5([ChemicalInput(name="water", role="solvent", quantity_g=1), ChemicalInput(name="dmf", role="solvent", quantity_g=9)]).score == 6.3
    assert score_p7([ChemicalInput(name="water", role="solvent", quantity_g=1), ChemicalInput(name="ethanol", role="reagent", quantity_g=9)]).score == 0.0
    assert score_p9([ChemicalInput(name="enzyme", role="catalyst", quantity_g=1), ChemicalInput(name="base", role="base", quantity_g=9)]).score == 7.2
    assert score_p10(
        [ChemicalInput(name="environmental", role="reagent", quantity_g=1), ChemicalInput(name="none", role="reagent", quantity_g=9)],
        {"environmental": ["H410"], "none": []},
    ).score == 1.0
    assert score_p12(
        [ChemicalInput(name="physical", role="reagent", quantity_g=1), ChemicalInput(name="none", role="reagent", quantity_g=9)],
        {"physical": ["H225"], "none": []},
    ).score == 0.6


def test_p4_with_complete_product_hazard_data_remains_independently_scoreable_without_mass():
    result = score_p4([ChemicalInput(name="product", role="product")], {"product": ["H351"]})

    assert result.score == 8.0
    assert result.confidence == ScoreProvenance.CALCULATED
