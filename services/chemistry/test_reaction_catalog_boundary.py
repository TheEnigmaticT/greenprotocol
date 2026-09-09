"""Generated reactants must not extend the verified source catalog."""
from smiles_extractor import validate_reaction_smiles


def test_rejects_added_unverified_workup_reactant():
    valid, reason, _ = validate_reaction_smiles(
        "CC.O>>CCO", known_reactants=[{"name": "ethane", "smiles": "CC"}],
        declared_products=[{"name": "ethanol", "smiles": "CCO"}],
    )
    assert not valid
    assert "catalog" in reason.lower()


def test_preserves_declared_product_with_additional_byproduct():
    valid, _, desired = validate_reaction_smiles(
        "CC.O>>O.CCO", known_reactants=[{"name": "ethane", "smiles": "CC"}, {"name": "water", "smiles": "O"}],
        declared_products=[{"name": "ethanol", "smiles": "CCO"}],
    )
    assert valid
    assert desired == 1
