"""Reference-name echoes must use the same alias path as display names."""
from scoring.models import ChemicalInput
from scoring import p5_safer_solvents as p5
from scoring import p7_renewable_feedstocks as p7
from identity import preferred_identity_name


def test_supplied_combined_reference_name_reaches_solvent_lookup_canonically(monkeypatch):
    calls = []
    monkeypatch.setattr(p5, "lookup_solvent", lambda name: calls.append(name))
    alias = "DMF (N,N-dimethylformamide)"
    p5.score_p5([ChemicalInput(name=alias, reference_name=alias, role="solvent", quantity_g=1)])
    assert calls == [preferred_identity_name(alias)]


def test_supplied_combined_reference_name_reaches_feedstock_lookup_canonically(monkeypatch):
    calls = []
    monkeypatch.setattr(p7, "is_renewable", lambda name: calls.append(name) or False)
    alias = "EtOH (ethanol)"
    p7.score_p7([ChemicalInput(name=alias, reference_name=alias, role="reagent", quantity_g=1)])
    assert calls == [preferred_identity_name(alias)]
