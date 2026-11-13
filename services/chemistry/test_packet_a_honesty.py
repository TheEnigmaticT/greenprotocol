"""Packet A: missing-data honesty and unavailable-score correctness.

Strict RED tests covering:
  - P1 mass-weighted scoring must not invent a 10g/chemical fallback.
  - P3 absent hazard evidence is not safety; unknown participants excluded.
  - P4 no-product case must return -1 (unavailable), not 0.
  - PrincipleScore cross-field validator must actually run.
  - Waste analysis must exclude chemicals with no mass from authoritative totals.
  - main.py aggregation must mark grade INCOMPLETE when partial coverage.
  - Synthetic regression fixtures (perovskite, product omission, unknown hazard).

These tests are scoped to Packet A only — they do not assert behaviour outside
the owned paths (services/chemistry/scoring/**, services/chemistry/main.py).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from scoring import models as scoring_models
from scoring import input_honesty as honesty
from scoring.models import (
    ChemicalInput,
    PrincipleScore,
    ScoreProvenance,
    ScoringRequest,
    ScoringResponse,
)
from scoring.p1_waste_prevention import score_p1
from scoring.p3_less_hazardous import score_p3
from scoring.p4_product_toxicity import score_p4
from scoring.waste_analysis import compute_waste_analysis


# ── Helpers ────────────────────────────────────────────────────────


def _chem(name: str, *, role: str = "reagent", quantity_g: float | None = None) -> ChemicalInput:
    return ChemicalInput(name=name, role=role, quantity_g=quantity_g)


# ── P1: no fabricated 10g fallback ─────────────────────────────────


def test_p1_does_not_invent_10g_when_all_masses_missing():
    """All chemicals missing quantity_g => PMI unavailable, score=-1.

    Today p1_waste_prevention.py substitutes ``sum(10.0 for _ in chemicals)``
    which silently turns zero data into a confident 10g/chemical PMI.
    """
    chems = [_chem("A"), _chem("B"), _chem("C")]
    result = score_p1(chemicals=chems, yield_pct=80.0, reaction_type="Suzuki")
    assert result.score == -1.0
    assert result.normalized == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    missing = result.details.get("missing_inputs", [])
    assert any(m.get("input") == "quantity_g" for m in missing), (
        "P1 must enumerate chemicals with missing mass, not silently substitute 10g"
    )


def test_p1_partial_masses_unavailable():
    """One chemical has mass, one does not => still unavailable.

    Mass-weighted PMI cannot be honestly derived from a partial mass set.
    """
    chems = [_chem("reactant", role="reactant", quantity_g=5.0), _chem("solvent", role="solvent")]
    result = score_p1(chemicals=chems, yield_pct=70.0, reaction_type="Suzuki")
    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE


# ── P3: unknown hazard ≠ safety, do not silently grade a subset ────


def test_p3_missing_hazard_evidence_is_unavailable():
    """Chemical absent from hcodes_map => P3 must be unavailable, not 0.

    Empty list lookup (``hcodes_map.get(name, [])``) collapses absent hazard
    evidence into 'no hazards' which silently upgrades a poorly-mapped
    protocol to a perfect 0/10 score.
    """
    chems = [_chem("benzene", quantity_g=10.0), _chem("unknown_reagent", quantity_g=5.0)]
    hcodes_map = {"benzene": ["H350", "H340"]}  # missing unknown_reagent
    result = score_p3(chemicals=chems, hcodes_map=hcodes_map)
    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    missing = result.details.get("missing_inputs", [])
    assert any(m.get("input") == "hcodes" and m.get("chemical") == "unknown_reagent"
               for m in missing), "P3 must surface which chemical lacked hazard evidence"


def test_p3_full_hazard_evidence_scores_normally():
    """When every chemical has a recorded lookup, scoring proceeds normally."""
    chems = [_chem("benzene", quantity_g=10.0), _chem("toluene", quantity_g=10.0)]
    hcodes_map = {"benzene": ["H350"], "toluene": ["H225"]}  # nonempty evidence, physical-only for fixture
    result = score_p3(chemicals=chems, hcodes_map=hcodes_map)
    assert result.score >= 0.0
    assert result.confidence in (ScoreProvenance.CALCULATED, ScoreProvenance.BENCHMARK)


# ── P4: no product => -1, not 0 ────────────────────────────────────


def test_p4_no_product_returns_unavailable_negative_one():
    """Without products, P4 score must be -1 (matches confidence=unavailable)."""
    chems = [_chem("reactant", role="reactant", quantity_g=5.0),
             _chem("solvent", role="solvent", quantity_g=50.0)]
    result = score_p4(chemicals=chems, hcodes_map={"reactant": ["H315"], "solvent": ["H225"]})
    assert result.score == -1.0, f"Expected -1.0, got {result.score}"
    assert result.normalized == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE


# ── PrincipleScore cross-field validator is currently dead ─────────


def test_principle_score_validator_catches_unavailable_with_zero():
    """The cross-field validator must reject UNAVAILABLE + score != -1.

    Currently the validator runs before the ``confidence`` field is
    populated, so ``info.data.get('confidence')`` is None and the check
    is dead. We construct an invalid pair directly via model_validate to
    surface the bug.
    """
    with pytest.raises(ValidationError) as exc:
        PrincipleScore(
            principle_number=99,
            principle_name="Test Dead Validator",
            score=0.0,
            normalized=0.0,
            confidence=ScoreProvenance.UNAVAILABLE,
            data_sources=[],
        )
    assert "Unavailable scores must have score = -1" in str(exc.value), (
        "Cross-field validator never fires — confidence not yet validated"
        " when score's validator runs (declared before confidence)."
    )


# ── Waste analysis: no fabricated mass totals ──────────────────────


def test_waste_analysis_omits_chemicals_without_mass_from_authoritative_totals():
    """Waste kg must be the sum of recorded kg, not include synthetic 10g fillers.

    ``safe_kg`` already coerces missing to 0.0, so this is the assertion that
    the totals reflect *recorded* kg only and the analysis surfaces when
    coverage is incomplete (so downstream UI can mark the analysis partial).
    """
    chems = [
        ChemicalInput(name="water", role="solvent", quantity_g=1000.0, quantity_kg=1.0),
        ChemicalInput(name="unknown_qty_solvent", role="solvent"),  # quantity_g and quantity_kg both None
    ]
    waste = compute_waste_analysis(chemicals=chems, hcodes_map={})
    # Known input mass is an inventory observation, not a complete waste total.
    assert waste["observedInputInventory"]["knownInputMassKg"] == pytest.approx(1.0, rel=1e-4)
    assert waste["directWaste"]["solventWasteKg"] is None
    assert waste["summary"]["confidence"] == "unavailable"


# ── input_honesty helpers (recovered scoped semantics) ─────────────


def test_finite_positive_mass_rejects_none_and_zero():
    assert honesty.finite_positive_mass(_chem("a", quantity_g=10.0)) == 10.0
    assert honesty.finite_positive_mass(_chem("a", quantity_g=None)) is None
    assert honesty.finite_positive_mass(_chem("a", quantity_g=0.0)) is None
    assert honesty.finite_positive_mass(_chem("a", quantity_g=-1.0)) is None


def test_missing_mass_inputs_lists_each_culprit():
    chems = [_chem("ok", quantity_g=1.0), _chem("bad1"), _chem("bad2", quantity_g=0.0)]
    missing = honesty.missing_mass_inputs(chems)
    names = {m["chemical"] for m in missing}
    assert names == {"bad1", "bad2"}


def test_missing_hcodes_inputs_lists_only_unknowns():
    chems = [_chem("known"), _chem("unknown_reagent")]
    missing = honesty.missing_hcodes_inputs(chems, {"known": ["H315"]})
    assert [m["chemical"] for m in missing] == ["unknown_reagent"]


def test_unavailable_score_factory_builds_valid_principle_score():
    score = honesty.unavailable_score(
        principle_number=11,
        principle_name="Realtime Analysis",
        missing_inputs=[{"chemical": "x", "input": "y", "reason": "z"}],
        provenance="unavailable: x missing",
        data_sources=[],
    )
    assert score.score == -1.0
    assert score.normalized == -1.0
    assert score.confidence == ScoreProvenance.UNAVAILABLE
    assert score.details["missing_inputs"] == [{"chemical": "x", "input": "y", "reason": "z"}]


# ── Aggregation: partial coverage must be marked INCOMPLETE ─────────


def test_aggregation_marks_grade_incomplete_when_partial():
    """When at least one principle is unavailable, grade must be INCOMPLETE.

    Today main.py filters unavailable scores out and assigns a letter grade
    over a partial set. This silently misrepresents coverage as complete.
    """
    import asyncio
    from main import score_protocol
    from scoring.models import ScoringRequest

    # Build a request that forces at least one unavailable principle (P4 has no product).
    req = ScoringRequest(
        chemicals=[
            ChemicalInput(name="water", role="solvent", quantity_g=1000.0),
            ChemicalInput(name="reactant", role="reactant", quantity_g=5.0),
        ],
        protocol_text="Mix.",
    )

    response = asyncio.run(score_protocol(req))
    assert response.grade in ("A", "B", "C", "D", "F", "INCOMPLETE"), (
        f"Unexpected grade {response.grade}"
    )
    # When at least one principle is unavailable, grade must be INCOMPLETE.
    unavailable_count = sum(1 for s in response.scores if s.score < 0)
    if unavailable_count > 0:
        assert response.grade == "INCOMPLETE", (
            f"Grade must be INCOMPLETE when {unavailable_count} principle(s) unavailable, "
            f"got {response.grade}"
        )
        assert response.coverage is not None
        assert response.coverage.unavailable == unavailable_count
        assert response.coverage.partial is True
        assert response.coverage.assessed == 12 - unavailable_count
    else:
        assert response.grade != "INCOMPLETE", (
            "Grade must be a letter when no principle is unavailable"
        )


# ── Synthetic regressions ──────────────────────────────────────────


def test_synthetic_perovskite_merged_masses_unavailable():
    """Perovskite protocol with three merged-mass precursors — partial masses.

    Today p1 substitutes 10g for the missing entries. With honesty, all
    required masses are missing so the score must be -1.
    """
    chems = [
        _chem("PbI2", role="reactant", quantity_g=4.6),
        _chem("MAI", role="reactant", quantity_g=1.6),
        _chem("DMSO", role="solvent", quantity_g=10.0),
        _chem("DMF", role="solvent"),  # mass not declared in protocol
    ]
    result = score_p1(chemicals=chems, yield_pct=85.0, reaction_type="Crystallization")
    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE


def test_synthetic_product_omission_p4_unavailable():
    """Protocol lists reactants and solvents only — no products.

    P4 must mark itself unavailable (-1), not a confident 0.
    """
    chems = [
        _chem("aniline", role="reactant", quantity_g=2.0),
        _chem("acetic anhydride", role="reagent", quantity_g=2.5),
        _chem("DCM", role="solvent", quantity_g=30.0),
    ]
    result = score_p4(chemicals=chems, hcodes_map={
        "aniline": ["H351"],
        "acetic anhydride": ["H314"],
        "DCM": ["H351"],
    })
    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE


def test_synthetic_unrecognized_hazard_record_p3_unavailable():
    """A chemical whose name is not in the hazard lookup is not 'safe'.

    P3 must surface the missing evidence rather than silently grade the
    remaining known subset as if it were the whole protocol.
    """
    chems = [
        _chem("acetonitrile", role="solvent", quantity_g=20.0),
        _chem("exotic_reagent_x_91", role="reagent", quantity_g=1.0),
    ]
    hcodes = {"acetonitrile": ["H225"]}  # exotic_reagent_x_91 absent
    result = score_p3(chemicals=chems, hcodes_map=hcodes)
    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE


# ── P5: identity-verified solvent role under workup/extraction/wash ─


def test_p5_ethyl_acetate_legacy_workup_assessed_as_solvent():
    """Ethyl acetate with legacy role='workup' must be assessed as solvent.

    CHEM21 identity is the verifier — ethyl acetate is in the curated
    index, so the workup/extraction/wash process-use does not exclude
    it from P5 scoring.
    """
    from scoring.p5_safer_solvents import score_p5

    chems = [
        ChemicalInput(name="DCM", role="solvent", quantity_g=30.0),
        ChemicalInput(name="ethyl acetate", role="workup", quantity_g=20.0),
    ]
    result = score_p5(chemicals=chems)
    assert result.score >= 0.0, (
        f"Ethyl acetate under legacy workup role should be scored; got "
        f"score={result.score}, details={result.details}"
    )
    assert result.confidence in (ScoreProvenance.CALCULATED, ScoreProvenance.BENCHMARK)
    assessed_names = {s["name"] for s in result.details.get("solvents", [])}
    assert "ethyl acetate" in assessed_names, (
        f"Ethyl acetate must appear in assessed solvents, got {assessed_names}"
    )


def test_p5_salt_workup_not_blindly_assessed_as_solvent():
    """Na2CO3/NaCl under workup must NOT be treated as solvent.

    The CHEM21 index has no entry for these salts, so they must not be
    silently classified as solvents. P5 should ignore them or, if it
    surfaces them, mark them as 'not a curated solvent'.
    """
    from scoring.p5_safer_solvents import score_p5

    chems = [
        ChemicalInput(name="DCM", role="solvent", quantity_g=30.0),
        ChemicalInput(name="Na2CO3", role="workup", quantity_g=5.0),
        ChemicalInput(name="NaCl", role="wash", quantity_g=2.0),
    ]
    result = score_p5(chemicals=chems)
    assessed_names = {s["name"] for s in result.details.get("solvents", [])}
    # The salts must not be blindly graded as solvents.
    assert "Na2CO3" not in assessed_names, (
        "Na2CO3 must not be blindly assessed as solvent — not in CHEM21 index"
    )
    assert "NaCl" not in assessed_names, (
        "NaCl must not be blindly assessed as solvent — not in CHEM21 index"
    )
    # The real solvent must still be assessed.
    assert "DCM" in assessed_names, "DCM (role=solvent) must remain assessed"


def test_p5_process_use_field_preserved_on_chemical_input():
    """Optional process_use field on ChemicalInput is accepted and preserved.

    Parent TS will populate process_use from parsed processUse so the
    scorer's role filter can rely on either role or function context.
    """
    chem = ChemicalInput(
        name="ethyl acetate",
        role="workup",
        quantity_g=20.0,
        process_use="workup_solvent",
    )
    assert chem.process_use == "workup_solvent"
