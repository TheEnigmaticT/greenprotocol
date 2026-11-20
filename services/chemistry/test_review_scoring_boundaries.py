"""Reviewer scoring-boundary regressions: B1 (P1 mass honesty), B2 (P5 role
handling), B5 (confidence provenance), plus narrow role/evidence consistency.

Scope: ``services/chemistry/scoring/**`` only.  No network access, no real LLM
calls — the model-inferred principles are exercised with an injected response.

Strict RED tests:
  - B1: P1 must never fabricate a product mass.  A reactant without a declared
    molecular weight makes PMI unavailable instead of raising ``max()`` on an
    empty sequence; the 0.5x output-mass fallback is gone; a product's own
    mass never enters the PMI numerator; a measured product mass still scores.
  - B2: a curated CHEM21 workup solvent (ethyl acetate) is scored even when it
    carries the legacy ``workup_solvent`` alias or a canonical process use.
    Salts under a workup role are not solvents.  An explicit solvent with no
    curated classification makes P5 unavailable.  An unknown role is not a
    solvent.
  - B5: ``model-inferred`` is a canonical provenance string and must survive as
    MODEL_INFERRED; legacy aliases map explicitly; unknown values are rejected
    instead of being relabelled "calculated".
  - Evidence: P10/P12 use the shared ``missing_hcodes_inputs`` helper, so an
    unresolved reference status is missing evidence even when codes exist.
  - Role consistency: P1/P7/P9 drop the same product syms P4 evaluates, while
    an unknown role stays an input and a missing input mass stays fatal.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from pydantic import ValidationError

from scoring.models import ChemicalInput, PrincipleScore, ScoreProvenance
from scoring.p1_waste_prevention import score_p1
from scoring.p4_product_toxicity import PRODUCT_ROLES, score_p4
from scoring.p5_safer_solvents import score_p5
from scoring.p7_renewable_feedstocks import score_p7
from scoring.p9_catalysis import score_p9
from scoring.p10_degradation import score_p10
from scoring.p12_accident_prevention import score_p12


# ── Helpers ────────────────────────────────────────────────────────


def _chem(name: str, *, role: str = "reagent", **kwargs) -> ChemicalInput:
    return ChemicalInput(name=name, role=role, **kwargs)


def _missing(result: PrincipleScore) -> list[dict]:
    return (result.details or {}).get("missing_inputs", []) or []


def _assessed_solvents(result: PrincipleScore) -> set[str]:
    return {s["name"] for s in (result.details or {}).get("solvents", [])}


# ── B1: P1 never fabricates a product mass ─────────────────────────


def test_p1_missing_molecular_weight_is_unavailable_not_an_exception():
    """A reactant with moles but no MW must not raise ``max()`` on empty.

    The old limiting-reagent branch called ``max()`` over an empty generator
    when no reactant carried a molecular weight, which crashed the whole
    scoring request instead of reporting an honest unavailable score.
    """
    chems = [_chem("fixture", role="reactant", quantity_g=10.0, quantity_mol=0.128)]
    result = score_p1(chemicals=chems, yield_pct=50.0, reaction_type="X")

    assert result.score == -1.0
    assert result.normalized == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert any(
        m.get("input") == "product_mass_g"
        for m in _missing(result)
    ), "Reactant molecular weight alone would not establish the missing product mass"


def test_p1_without_reactant_moles_does_not_fabricate_product_mass():
    """No limiting reagent, no measured product mass => no invented output.

    The old ``non_solvent_mass * yield * 0.5`` fallback invented a product
    mass out of nothing.
    """
    chems = [_chem("fixture", role="reagent", quantity_g=10.0)]
    result = score_p1(chemicals=chems, yield_pct=50.0, reaction_type="X")

    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert (result.details or {}).get("product_mass_g") is None
    assert (result.details or {}).get("pmi") is None


def test_p1_product_mass_is_not_added_to_the_input_numerator():
    """A declared product is an output, not an input, for PMI.

    PMI = total inputs / product mass.  Counting the product's own mass in
    the numerator double-counts it and flatters the score.
    """
    chems = [
        _chem("reactant", role="reactant", quantity_g=10.0),
        _chem("product", role="product", quantity_g=8.0),
    ]
    result = score_p1(chemicals=chems, yield_pct=50.0, reaction_type="X")

    assert result.details["total_input_g"] == 10.0
    assert result.details["product_mass_g"] == 8.0
    assert result.score >= 0.0
    assert result.confidence != ScoreProvenance.UNAVAILABLE


def test_p1_product_without_mass_is_not_fabricated_from_reactant_mass():
    """Known input mass does not establish the missing output denominator."""
    chems = [
        _chem(
            "reactant",
            role="reactant",
            quantity_g=10.0,
            quantity_mol=0.1,
            molecular_weight=100.0,
        ),
        _chem("product", role="product", quantity_g=None),
    ]
    result = score_p1(chemicals=chems, yield_pct=50.0, reaction_type="X")

    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert any(item['input'] == 'product_mass_g' for item in _missing(result))


def test_p1_unknown_role_remains_an_input():
    """An unknown role is an input: it stays in the PMI numerator."""
    chems = [_chem("mystery", role="unknown", quantity_g=10.0)]
    result = score_p1(chemicals=chems, yield_pct=50.0, reaction_type="X")

    assert result.details["total_input_g"] == 10.0


# ── B2: P5 role handling ───────────────────────────────────────────


def test_p5_curated_workup_solvent_with_legacy_process_use_is_scored():
    """Ethyl acetate labelled ``workup`` with the legacy alias is a solvent.

    ``workup_solvent`` is a legacy alias only; the canonical process-use enum
    is reaction/extraction/wash/quench/drying.  Neither may silently drop a
    curated CHEM21 solvent from the score.
    """
    chems = [
        _chem("ethyl acetate", role="workup", quantity_g=20.0, process_use="workup_solvent")
    ]
    result = score_p5(chemicals=chems)

    assert "ethyl acetate" in _assessed_solvents(result), (
        f"curated workup solvent dropped; assessed={_assessed_solvents(result)}"
    )
    assert result.score >= 0.0
    assert result.confidence == ScoreProvenance.CALCULATED


def test_p5_curated_workup_solvent_with_canonical_process_use_is_scored():
    """The canonical ``wash`` process use must not disqualify a curated solvent."""
    chems = [_chem("ethyl acetate", role="workup", quantity_g=20.0, process_use="wash")]
    result = score_p5(chemicals=chems)

    assert "ethyl acetate" in _assessed_solvents(result)


def test_p5_canonical_reaction_process_use_does_not_disqualify_a_solvent():
    """``process_use='reaction'`` must not drop an explicitly labelled solvent."""
    chems = [_chem("ethyl acetate", role="solvent", quantity_g=20.0, process_use="reaction")]
    result = score_p5(chemicals=chems)

    assert "ethyl acetate" in _assessed_solvents(result)


def test_p5_salts_under_workup_roles_are_not_solvents():
    """Salts under a workup/wash role are not curated solvents."""
    chems = [
        _chem("NaCl", role="workup", quantity_g=2.0, process_use="wash"),
        _chem("Na2CO3", role="workup_solvent", quantity_g=5.0),
        _chem("DCM", role="solvent", quantity_g=30.0),
    ]
    result = score_p5(chemicals=chems)
    assessed = _assessed_solvents(result)

    assert "NaCl" not in assessed
    assert "Na2CO3" not in assessed
    assert "DCM" in assessed


def test_p5_explicit_solvent_without_curated_evidence_is_unavailable(monkeypatch):
    """An explicitly stated solvent with no guide entry cannot be scored."""
    import scoring.p5_safer_solvents as p5

    monkeypatch.setattr(p5, "lookup_solvent", lambda _name: None)
    result = p5.score_p5([_chem("unlisted solvent", role="solvent", quantity_g=5.0)])

    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE


def test_p5_unknown_role_is_not_treated_as_solvent():
    """An unknown role must not become a solvent just because of its identity."""
    chems = [
        _chem("ethyl acetate", role="unknown", quantity_g=20.0),
        _chem("DCM", role="solvent", quantity_g=30.0),
    ]
    result = score_p5(chemicals=chems)
    assessed = _assessed_solvents(result)

    assert "ethyl acetate" not in assessed
    assert "DCM" in assessed


# ── B5: confidence provenance ──────────────────────────────────────


def _principle(**overrides) -> PrincipleScore:
    """Build a PrincipleScore from raw values (keeps the string labels honest)."""
    payload = {
        "principle_number": 8,
        "principle_name": "Reduce Derivatives",
        "score": 0.0,
        "normalized": 0.0,
    }
    payload.update(overrides)
    return PrincipleScore.model_validate(payload)


def test_confidence_model_inferred_canonical_string_is_preserved():
    """``model-inferred`` is canonical and must stay MODEL_INFERRED."""
    score = _principle(confidence="model-inferred")
    assert score.confidence is ScoreProvenance.MODEL_INFERRED


def test_confidence_legacy_aliases_map_explicitly():
    """Legacy aliases keep their explicit historical meaning."""
    assert _principle(confidence="estimated").confidence is ScoreProvenance.MODEL_INFERRED
    assert _principle(confidence="partial").confidence is ScoreProvenance.BENCHMARK


def test_confidence_unknown_value_is_rejected():
    """An unknown provenance string must be rejected, not relabelled."""
    with pytest.raises(ValidationError):
        _principle(confidence="totally-made-up")


def test_p8_reports_model_inferred_with_injected_response(monkeypatch):
    """P8's step classification is model-inferred (no real LLM call)."""
    import scoring.p8_reduce_derivatives as p8

    async def fake_call_llm(prompt, system=None):
        return json.dumps(
            [{"step": 1, "classification": "construction", "reason": "injected"}]
        )

    monkeypatch.setattr(p8, "call_llm", fake_call_llm)
    steps = [{"stepNumber": 1, "description": "Bond formation", "chemicals": [{"name": "A"}]}]

    result = asyncio.run(p8.score_p8(steps=steps, protocol_text="protocol text"))

    assert result.score == 0.0
    assert result.confidence is ScoreProvenance.MODEL_INFERRED


def test_p11_reports_model_inferred_with_injected_response(monkeypatch):
    """P11 is an AI assessment: model-inferred (no real LLM call)."""
    import scoring.p11_realtime_analysis as p11

    async def fake_call_llm(prompt, system=None):
        return json.dumps(
            {
                "score": 3,
                "monitoring_present": [],
                "monitoring_absent": [],
                "reasoning": "injected",
            }
        )

    monkeypatch.setattr(p11, "call_llm", fake_call_llm)
    steps = [{"stepNumber": 1, "description": "heat", "chemicals": []}]

    result = asyncio.run(p11.score_p11(steps=steps, protocol_text="protocol text"))

    assert result.score == 3.0
    assert result.confidence is ScoreProvenance.MODEL_INFERRED


# ── Evidence: P10/P12 share the missing-evidence helper ───────────


def test_p10_unresolved_reference_status_is_missing_evidence():
    """Unresolved reference + non-empty codes is still missing evidence."""
    chems = [_chem("benzene", role="solvent", quantity_g=10.0, reference_status="indefinite")]
    result = score_p10(chems, {"benzene": ["H410"]})

    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert any(
        m.get("input") == "hcodes" and m.get("chemical") == "benzene"
        for m in _missing(result)
    )


def test_p12_unresolved_reference_status_is_missing_evidence():
    """Unresolved reference + non-empty codes is still missing evidence."""
    chems = [_chem("benzene", role="solvent", quantity_g=10.0, reference_status="indefinite")]
    result = score_p12(chems, {"benzene": ["H225"]})

    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert any(
        m.get("input") == "hcodes" and m.get("chemical") == "benzene"
        for m in _missing(result)
    )


def test_p10_resolved_reference_with_codes_scores_normally():
    """Resolved reference + non-empty codes supports a real score."""
    chems = [_chem("benzene", role="solvent", quantity_g=10.0, reference_status="available")]
    result = score_p10(chems, {"benzene": ["H410"]})

    assert result.score >= 0.0
    assert result.confidence == ScoreProvenance.CALCULATED


def test_p12_resolved_reference_with_codes_scores_normally():
    """Resolved reference + non-empty codes supports a real score."""
    chems = [_chem("benzene", role="solvent", quantity_g=10.0, reference_status="available")]
    result = score_p12(chems, {"benzene": ["H225"]})

    assert result.score >= 0.0
    assert result.confidence == ScoreProvenance.CALCULATED


# ── Role consistency across scorers ────────────────────────────────


PRODUCT_SYMS = [
    "product",
    "desired product",
    "target",
    "intermediate",
    "final product",
    "main product",
    "byproduct",
]


def test_p4_still_exports_product_roles_for_downstream_consumers():
    """The waste agent imports PRODUCT_ROLES from P4 — it must stay available."""
    assert "product" in PRODUCT_ROLES
    assert "desired product" in PRODUCT_ROLES


@pytest.mark.parametrize("sym", PRODUCT_SYMS)
def test_p7_drops_the_same_product_syms_as_p4(sym):
    """P7 must not count a declared output as a renewable *input*."""
    chems = [
        _chem("ethanol", role=sym, quantity_g=10.0),
        _chem("benzene", role="reagent", quantity_g=10.0),
    ]
    result = score_p7(chems)

    assert result.details["total_mass_g"] == 10.0, (
        f"role {sym!r} must be excluded from the P7 mass denominator"
    )
    assert "ethanol" not in {c["name"] for c in result.details["chemicals"]}


@pytest.mark.parametrize("sym", PRODUCT_SYMS)
def test_p9_drops_the_same_product_syms_as_p4(sym):
    """P9 must not count a declared output as a stoichiometric reagent."""
    chems = [
        _chem("Pd/C", role="catalyst", quantity_g=0.1),
        _chem("ethyl acetate", role=sym, quantity_g=50.0),
    ]
    result = score_p9(chems)

    assert result.details["stoichiometric_mass_g"] == 0.0, (
        f"role {sym!r} must be excluded from the P9 reagent mass"
    )
    assert "ethyl acetate" not in {c["name"] for c in result.details["chemicals"]}


def test_unknown_role_is_kept_as_an_input_in_p7_and_p9():
    """Unknown roles are not silently dropped from mass-weighted scorers."""
    chems = [_chem("mystery", role="unknown", quantity_g=10.0)]

    p7 = score_p7(chems)
    assert p7.details["total_mass_g"] == 10.0

    p9 = score_p9(chems)
    assert p9.details["stoichiometric_mass_g"] == 10.0


def test_missing_input_mass_keeps_p1_p7_p9_unavailable():
    """A missing input mass stays fatal — excluded outputs do not excuse it."""
    chems = [_chem("benzene", role="reagent", quantity_g=None)]

    for result in (
        score_p1(chemicals=chems, yield_pct=50.0),
        score_p7(chems),
        score_p9(chems),
    ):
        assert result.score == -1.0
        assert result.confidence == ScoreProvenance.UNAVAILABLE
