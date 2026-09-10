import asyncio
import pytest
import main
from scoring.models import ChemicalInput, ScoringRequest, PrincipleScore, ScoreProvenance


@pytest.mark.parametrize("record", [None, {}, {"cid": 999}, {"hcodes": []}, {"ghs_hazards": []}])
def test_missing_hazard_evidence_is_not_a_known_safe_empty_list(monkeypatch, record):
    monkeypatch.setattr(main.chem_cache, "get", lambda key: record if key == "unknown material" else None)
    assert main._hcodes_from_cache("unknown material") is None


def test_known_hazard_codes_survive_canonical_lookup(monkeypatch):
    monkeypatch.setattr(main.chem_cache, "get", lambda key: {"hcodes": ["H360D"]} if key == "N,N-Dimethylformamide" else None)
    assert main._hcodes_from_cache("DMF") == ["H360D"]


def test_score_handler_does_not_turn_missing_cached_hazards_into_zero_risk(monkeypatch):
    monkeypatch.delenv("GCAI_LOCAL_HELPERS", raising=False)
    monkeypatch.setattr(main.chem_cache, "get", lambda key: None)
    async def unavailable(**kwargs):
        return PrincipleScore(principle_number=8, principle_name="Unavailable", score=-1, normalized=-1, confidence=ScoreProvenance.UNAVAILABLE)
    monkeypatch.setattr(main, "score_p8", unavailable)
    monkeypatch.setattr(main, "score_p11", unavailable)
    result = asyncio.run(main.score_protocol(ScoringRequest(
        chemicals=[ChemicalInput(name="unknown material", role="reactant", quantity_g=10)],
        steps=[], protocol_text="",
    )))
    for score in result.scores:
        if score.principle_number in (3, 12):
            assert score.confidence == "unavailable"
            assert score.score == -1
