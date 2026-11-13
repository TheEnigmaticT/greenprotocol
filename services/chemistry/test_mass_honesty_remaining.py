"""Packet A remaining-scorer honesty: P7/P9/P10/P12.

Strict RED tests covering:
  - P7 / P9 mass-weighted calculations must not invent a 10g/chemical fallback
    when any evaluated chemical lacks a finite positive declared mass.
  - P10 / P12 must not silently grade safe (score=0) when GHS hazard evidence
    is unknown (chemical absent from hcodes_map) OR empty (lookup returned no
    codes). Non-empty codes that simply do not match the evaluated hazard
    class still support a real score of 0 (verified not the relevant hazard).

These tests cover only the four remaining-scorer paths; they do not assert
behaviour outside ``scoring/p7_renewable_feedstocks.py``,
``scoring/p9_catalysis.py``, ``scoring/p10_degradation.py``, and
``scoring/p12_accident_prevention.py``.
"""

from __future__ import annotations

import pytest

from scoring.models import ChemicalInput, PrincipleScore, ScoreProvenance
from scoring.p7_renewable_feedstocks import score_p7
from scoring.p9_catalysis import score_p9
from scoring.p10_degradation import score_p10
from scoring.p12_accident_prevention import score_p12


# ── Helpers ────────────────────────────────────────────────────────


def _chem(
    name: str,
    *,
    role: str = "reagent",
    quantity_g: float | None = None,
) -> ChemicalInput:
    return ChemicalInput(name=name, role=role, quantity_g=quantity_g)


def _missing_inputs(result: PrincipleScore) -> list[dict]:
    return result.details.get("missing_inputs", []) if result.details else []


# ── P7: renewable feedstocks mass honesty ──────────────────────────


def test_p7_missing_mass_returns_unavailable():
    """Any evaluated chemical missing quantity_g => P7 unavailable (-1)."""
    chems = [
        _chem("ethanol", role="solvent", quantity_g=None),  # missing
        _chem("benzene", role="reagent", quantity_g=50.0),
    ]
    result = score_p7(chems)
    assert result.score == -1.0
    assert result.normalized == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    missing = _missing_inputs(result)
    assert any(m.get("input") == "quantity_g" for m in missing), (
        "P7 must enumerate chemicals with missing mass, not silently substitute 10g"
    )


def test_p7_all_masses_present_scores_normally():
    """All declared masses finite positive => real score, CALCULATED."""
    chems = [
        _chem("ethanol", role="solvent", quantity_g=30.0),
        _chem("benzene", role="reagent", quantity_g=50.0),
    ]
    result = score_p7(chems)
    assert result.score >= 0.0
    assert result.confidence == ScoreProvenance.CALCULATED


# ── P9: catalysis mass honesty ─────────────────────────────────────


def test_p9_missing_mass_returns_unavailable():
    """Any non-excluded chemical missing quantity_g => P9 unavailable (-1)."""
    chems = [
        _chem("Pd", role="catalyst", quantity_g=0.5),
        _chem("iodobenzene", role="reagent", quantity_g=None),  # missing
    ]
    result = score_p9(chems)
    assert result.score == -1.0
    assert result.normalized == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    missing = _missing_inputs(result)
    assert any(m.get("input") == "quantity_g" for m in missing), (
        "P9 must enumerate chemicals with missing mass, not silently substitute 10g"
    )


def test_p9_all_masses_present_scores_normally():
    """All declared masses finite positive => real score, CALCULATED."""
    chems = [
        _chem("Pd", role="catalyst", quantity_g=0.5),
        _chem("iodobenzene", role="reagent", quantity_g=50.0),
    ]
    result = score_p9(chems)
    assert result.score >= 0.0
    assert result.confidence == ScoreProvenance.CALCULATED


# ── P10: degradation hazard evidence honesty ───────────────────────


def test_p10_missing_mass_returns_unavailable():
    """Missing quantity_g => P10 unavailable (-1)."""
    chems = [_chem("benzene", quantity_g=None)]
    hcodes = {"benzene": ["H225"]}
    result = score_p10(chems, hcodes)
    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert any(m.get("input") == "quantity_g" for m in _missing_inputs(result))


def test_p10_missing_hcodes_key_returns_unavailable():
    """Chemical absent from hcodes_map must not score as safe (0).

    Unknown hazard evidence is not a verified clean bill of health.
    """
    chems = [_chem("benzene", quantity_g=10.0)]
    hcodes: dict[str, list[str]] = {}  # benzene missing
    result = score_p10(chems, hcodes)
    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    missing = _missing_inputs(result)
    assert any(m.get("input") == "hcodes" for m in missing), (
        "P10 must flag unknown hazard evidence, not score it as safe"
    )


def test_p10_empty_hcodes_list_returns_unavailable():
    """Empty list (no evidence returned) must not score as safe (0).

    ``hcodes_map.get(name, [])`` collapses absent into []. An empty list is
    evidence that the lookup returned nothing — distinct from a verified-safe
    chemical that happens to have no H4xx codes.
    """
    chems = [_chem("benzene", quantity_g=10.0)]
    hcodes = {"benzene": []}
    result = score_p10(chems, hcodes)
    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE


def test_p10_valid_hcodes_no_env_hazard_scores_zero():
    """Non-empty codes with no H4xx environmental hazard => score 0 (real).

    Irrelevant hazard class is not a blocker; only missing/empty evidence is.
    """
    chems = [_chem("safe_solvent", quantity_g=10.0)]
    hcodes = {"safe_solvent": ["H225"]}  # only H2xx, no H4xx
    result = score_p10(chems, hcodes)
    assert result.score == 0.0
    assert result.confidence == ScoreProvenance.CALCULATED


# ── P12: accident prevention hazard evidence honesty ───────────────


def test_p12_missing_mass_returns_unavailable():
    """Missing quantity_g => P12 unavailable (-1)."""
    chems = [_chem("benzene", quantity_g=None)]
    hcodes = {"benzene": ["H225"]}
    result = score_p12(chems, hcodes)
    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert any(m.get("input") == "quantity_g" for m in _missing_inputs(result))


def test_p12_missing_hcodes_key_returns_unavailable():
    """Chemical absent from hcodes_map must not score as safe (0)."""
    chems = [_chem("benzene", quantity_g=10.0)]
    hcodes: dict[str, list[str]] = {}
    result = score_p12(chems, hcodes)
    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE
    assert any(m.get("input") == "hcodes" for m in _missing_inputs(result))


def test_p12_empty_hcodes_list_returns_unavailable():
    """Empty list (no evidence returned) must not score as safe (0)."""
    chems = [_chem("benzene", quantity_g=10.0)]
    hcodes = {"benzene": []}
    result = score_p12(chems, hcodes)
    assert result.score == -1.0
    assert result.confidence == ScoreProvenance.UNAVAILABLE


def test_p12_valid_hcodes_no_physical_hazard_scores_zero():
    """Non-empty codes with no H2xx physical hazard => score 0 (real)."""
    chems = [_chem("safe_solvent", quantity_g=10.0)]
    hcodes = {"safe_solvent": ["H315"]}  # only H3xx, no H2xx
    result = score_p12(chems, hcodes)
    assert result.score == 0.0
    assert result.confidence == ScoreProvenance.CALCULATED
