import pytest
from scoring.models import ChemicalInput, ScoreProvenance
from scoring.p1_waste_prevention import score_p1


def inputs():
    return [ChemicalInput(name='input fixture', role='reactant', quantity_g=10, quantity_mol=.1, molecular_weight=100)]


def test_stated_yield_and_reactant_weight_do_not_establish_product_mass():
    result = score_p1(inputs(), yield_pct=50, yield_source='stated')
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert result.score == -1
    assert any(item['input'] == 'product_mass_g' for item in result.details['missing_inputs'])


def test_missing_product_mass_may_use_a_labelled_benchmark_but_not_a_fabricated_output():
    result = score_p1(inputs(), yield_pct=50, benchmark_pmi=20)
    assert result.confidence == ScoreProvenance.BENCHMARK
    assert result.details['method'] == 'benchmark_pmi_only'
    assert result.details['product_mass_g'] is None


def test_measured_product_is_the_denominator_not_an_extra_input():
    result = score_p1(inputs() + [ChemicalInput(name='output fixture', role='product', quantity_g=.2)])
    assert result.confidence == ScoreProvenance.CALCULATED
    assert result.details['total_input_g'] == 10
    assert result.details['pmi'] == pytest.approx(10 / .2)
    assert '0.2 g declared product' in result.details['_summary']


def test_multiple_declared_outputs_are_not_silently_first_or_largest_chosen():
    result = score_p1(inputs() + [
        ChemicalInput(name='output A', role='product', quantity_g=.2),
        ChemicalInput(name='output B', role='product', quantity_g=.1),
    ])
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert any(item['input'] == 'desired_product_scope' for item in result.details['missing_inputs'])


def test_measured_byproduct_is_not_the_missing_desired_product():
    result = score_p1(inputs() + [ChemicalInput(name='byproduct fixture', role='byproduct', quantity_g=1)])
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert result.details['total_input_g'] == 10
    assert any(item['input'] == 'product_mass_g' for item in result.details['missing_inputs'])


def test_byproduct_hazard_evidence_does_not_prove_a_desired_product_was_identified():
    from scoring.p4_product_toxicity import score_p4
    result = score_p4([ChemicalInput(name='byproduct fixture', role='byproduct', quantity_g=1)], {'byproduct fixture': ['H225']})
    assert result.confidence == ScoreProvenance.UNAVAILABLE
