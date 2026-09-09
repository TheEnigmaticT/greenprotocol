"""Boundary tests for verified chemical identity and reaction use."""

import asyncio

import cache
import main
import pytest
import smiles_extractor
from scoring.models import ChemicalInput, PrincipleScore, ScoringRequest


PHENYLBORONIC_ACID = "OB1=CC=CC=C1"
PHENOL = "Oc1ccccc1"
BIPHENYL = "c1ccc(-c2ccccc2)cc1"


def _score(number: int) -> PrincipleScore:
    return PrincipleScore(
        principle_number=number,
        principle_name=f"P{number}",
        score=1.0,
        normalized=0.1,
        details={},
        data_sources=["test"],
    )


def _no_model_scores(monkeypatch) -> None:
    for number in (1, 3, 4, 5, 6, 7, 9, 10, 12):
        monkeypatch.setattr(main, f"score_p{number}", lambda **_kwargs: _score(number))

    async def async_score(**_kwargs):
        return _score(8)

    monkeypatch.setattr(main, "score_p8", async_score)
    monkeypatch.setattr(main, "score_p11", async_score)
    monkeypatch.setattr(main, "extract_yield_and_type", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(main, "compute_waste_analysis", lambda **_kwargs: {})
    monkeypatch.setattr(main, "compute_regulatory_context", lambda **_kwargs: {})


def test_supplied_reaction_cannot_omit_an_unresolved_declared_reagent(monkeypatch):
    _no_model_scores(monkeypatch)
    response = asyncio.run(main.score_protocol(ScoringRequest(
        chemicals=[
            ChemicalInput(name="ethane", role="reagent", reference_smiles="CC", reference_status="available"),
            ChemicalInput(name="unresolved reagent", role="reagent", reference_status="unavailable"),
            ChemicalInput(name="ethanol", role="product", reference_smiles="CCO", reference_status="available"),
        ], reaction_smiles="CC>>CCO",
    )))
    assert response.scores[1].score == -1
    assert response.smiles_extraction["validated"] is False
    assert "unresolved" in " ".join(response.smiles_extraction["validation_errors"]).lower()


def test_predicted_product_is_explicitly_inferred_not_declared_identity(monkeypatch):
    _no_model_scores(monkeypatch)

    async def inferred_reaction(*_args, **_kwargs):
        return "CC>>CCO", {"inferred": True, "llm_called": True}

    monkeypatch.setattr(main, "extract_reaction_smiles", inferred_reaction)
    response = asyncio.run(main.score_protocol(ScoringRequest(
        chemicals=[ChemicalInput(name="ethane", role="reagent", reference_smiles="CC", reference_status="available")],
        protocol_text="Process the specified material.",
    )))
    assert response.smiles_extraction["product_provenance"] == "model-inferred"
    assert response.smiles_extraction["identity_validation"] == "reactants_verified_product_inferred"
    assert response.scores[1].confidence == "model-inferred"

    async def raw_prediction(*_args, **_kwargs):
        return "CC>>CCO"

    monkeypatch.setattr(smiles_extractor, "call_llm", raw_prediction)
    _, metadata = asyncio.run(smiles_extractor.extract_reaction_smiles("Process the specified material.", [
        {"name": "ethane", "role": "reagent", "reference_smiles": "CC", "reference_status": "available"},
    ]))
    assert metadata["product_provenance"] == "model-inferred"
    assert metadata["identity_validation"] == "reactants_verified_product_inferred"


def test_hcode_lookup_uses_the_same_exact_combined_alias_identity(monkeypatch):
    """Aliases must share the cached record without stripping inner formula brackets."""
    records = {
        "n,n-dimethylformamide": {"cid": 6228},
        "ghs_6228": {"hcodes": ["H360", "H373"]},
        "tetrakis(triphenylphosphine)palladium(0)": {
            "ghs_hazards": [{"code": "H302"}],
        },
    }
    monkeypatch.setattr(cache, "get", lambda key: records.get(key.casefold().strip()))

    assert main._hcodes_from_cache("DMF (N,N-dimethylformamide)") == ["H360", "H373"]
    assert main._hcodes_from_cache(
        "Pd(PPh3)4 (tetrakis(triphenylphosphine)palladium(0))"
    ) == ["H302"]


def test_chemical_input_preserves_null_raw_quantity_and_verified_reference_fields():
    chemical = ChemicalInput(
        name="DMF (N,N-dimethylformamide)",
        quantity=None,
        raw_quantity=None,
        reference_name="N,N-Dimethylformamide",
        reference_smiles="CN(C)C=O",
        reference_status="available",
        reference_provenance="cache",
        reference_hcodes=["H360"],
    )

    assert chemical.quantity is None
    assert chemical.raw_quantity is None
    assert chemical.reference_name == "N,N-Dimethylformamide"
    assert chemical.reference_smiles == "CN(C)C=O"
    assert chemical.reference_status == "available"
    assert chemical.reference_provenance == "cache"
    assert chemical.reference_hcodes == ["H360"]


def test_reaction_validation_rejects_substituted_known_reactant_and_product():
    validator = getattr(smiles_extractor, "validate_reaction_smiles", None)
    assert callable(validator), "reaction identity validation must be public"

    valid, reason, desired_product_index = validator(
        f"{PHENOL}>>{PHENOL}",
        known_reactants=[{"name": "phenylboronic acid", "smiles": PHENYLBORONIC_ACID}],
        declared_products=[{"name": "biphenyl", "smiles": BIPHENYL}],
    )

    assert valid is False
    assert "phenylboronic acid" in reason
    assert desired_product_index is None


def test_generated_reaction_is_constrained_to_verified_catalog(monkeypatch):
    async def fake_call_llm(*_args, **_kwargs):
        return f"{PHENOL}>>{BIPHENYL}"

    monkeypatch.setattr(smiles_extractor, "call_llm", fake_call_llm)
    reaction, metadata = asyncio.run(smiles_extractor.extract_reaction_smiles(
        "Couple the verified reagent to form the verified product.",
        chemicals=[
            {
                "name": "phenylboronic acid",
                "role": "reagent",
                "reference_smiles": PHENYLBORONIC_ACID,
                "reference_status": "available",
            },
            {
                "name": "biphenyl",
                "role": "product",
                "reference_smiles": BIPHENYL,
                "reference_status": "available",
            },
        ],
    ))

    assert reaction is None
    assert metadata["inferred"] is True
    assert metadata["validated"] is False
    assert any("phenylboronic acid" in error for error in metadata["validation_errors"])


def test_caller_reaction_is_not_allowed_to_bypass_verified_identity(monkeypatch):
    _no_model_scores(monkeypatch)
    captured: dict = {}

    def fake_p2(**kwargs):
        captured.update(kwargs)
        return _score(2)

    monkeypatch.setattr(main, "score_p2", fake_p2)
    request = ScoringRequest(
        chemicals=[
            ChemicalInput(
                name="phenylboronic acid",
                role="reagent",
                reference_smiles=PHENYLBORONIC_ACID,
                reference_status="available",
            ),
            ChemicalInput(
                name="biphenyl",
                role="product",
                reference_smiles=BIPHENYL,
                reference_status="available",
            ),
        ],
        reaction_smiles=f"{PHENOL}>>{BIPHENYL}",
    )

    response = asyncio.run(main.score_protocol(request))

    assert captured["reaction_smiles"] is None
    assert response.smiles_extraction["provided"] is True
    assert response.smiles_extraction["validated"] is False
    assert response.smiles_extraction["inferred"] is False


def test_indefinite_physical_materials_do_not_trigger_representative_reaction(monkeypatch):
    async def fail_if_called(*_args, **_kwargs):
        return "CC>>CC"

    monkeypatch.setattr(smiles_extractor, "call_llm", fail_if_called)
    reaction, metadata = asyncio.run(smiles_extractor.extract_reaction_smiles(
        "Cast cellulose acetate from brine.",
        chemicals=[
            {
                "name": "cellulose acetate",
                "role": "reagent",
                "reference_status": "indefinite",
            },
            {"name": "brine", "role": "workup", "reference_status": "indefinite"},
        ],
    ))

    assert reaction is None
    assert metadata["llm_called"] is False
    assert metadata["inferred"] is False
    assert "Verified molecular reactants" in metadata["validation_errors"][0]
