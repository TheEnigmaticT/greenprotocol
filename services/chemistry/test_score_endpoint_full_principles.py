"""Regression tests for complete principle-score coverage."""

import asyncio
import importlib

import main
from scoring.models import ChemicalInput, PrincipleScore, ScoringRequest, ScoreProvenance


def _score(number: int) -> PrincipleScore:
    return PrincipleScore(
        principle_number=number,
        principle_name=f"P{number}",
        score=1.0,
        normalized=0.1,
        details={},
        chemicals_flagged=[],
        data_sources=["test"],
        confidence=ScoreProvenance.CALCULATED,
    )


def test_score_endpoint_returns_all_twelve_principles(monkeypatch):
    """The score endpoint must not silently omit implemented principles."""
    monkeypatch.setattr(main, "extract_yield_and_type", _fake_yield_and_type)
    monkeypatch.setattr(main, "score_p1", lambda **kwargs: _score(1))
    monkeypatch.setattr(main, "score_p2", lambda **kwargs: _score(2))
    monkeypatch.setattr(main, "score_p3", lambda **kwargs: _score(3))
    monkeypatch.setattr(main, "score_p4", lambda **kwargs: _score(4))
    monkeypatch.setattr(main, "score_p5", lambda **kwargs: _score(5))
    monkeypatch.setattr(main, "score_p6", lambda **kwargs: _score(6))
    monkeypatch.setattr(main, "score_p7", lambda **kwargs: _score(7))
    monkeypatch.setattr(main, "score_p8", _fake_async_score(8))
    monkeypatch.setattr(main, "score_p9", lambda **kwargs: _score(9))
    monkeypatch.setattr(main, "score_p10", lambda **kwargs: _score(10))
    monkeypatch.setattr(main, "score_p11", _fake_async_score(11))
    monkeypatch.setattr(main, "score_p12", lambda **kwargs: _score(12))
    monkeypatch.setattr(main, "compute_waste_analysis", lambda **kwargs: {})
    monkeypatch.setattr(main, "compute_regulatory_context", lambda **kwargs: {})

    response = asyncio.run(main.score_protocol(_request()))

    assert [score.principle_number for score in response.scores] == list(range(1, 13))
    assert response.max_possible == 120.0


def test_score_endpoint_extracts_reaction_smiles_when_missing(monkeypatch):
    """P2 should receive a validated reaction equation on normal requests."""
    captured = {}

    async def fake_extract(*args, **kwargs):
        return "CCO>>CC=O", {"attempts": 1, "llm_called": True}

    def fake_p2(**kwargs):
        captured.update(kwargs)
        return _score(2)

    monkeypatch.setattr(main, "extract_reaction_smiles", fake_extract)
    monkeypatch.setattr(main, "score_p2", fake_p2)
    monkeypatch.setattr(main, "extract_yield_and_type", _fake_yield_and_type)
    for number in (1, 3, 4, 5, 6, 7, 9, 10, 12):
        monkeypatch.setattr(main, f"score_p{number}", lambda **kwargs: _score(number))
    monkeypatch.setattr(main, "score_p8", _fake_async_score(8))
    monkeypatch.setattr(main, "score_p11", _fake_async_score(11))
    monkeypatch.setattr(main, "compute_waste_analysis", lambda **kwargs: {})
    monkeypatch.setattr(main, "compute_regulatory_context", lambda **kwargs: {})

    response = asyncio.run(main.score_protocol(_request()))

    assert captured["reaction_smiles"] == "CCO>>CC=O"
    assert response.smiles_extraction["llm_called"] is True


def _request() -> ScoringRequest:
    return ScoringRequest(
        chemicals=[ChemicalInput(name="water", role="solvent", quantity="10 mL")],
        steps=[{"stepNumber": 1, "description": "mix", "conditions": {"temperature": "20 C"}}],
        protocol_text="Mix at 20 C.",
    )


def test_p11_retries_transient_empty_llm_response(monkeypatch):
    """A transient empty P11 response should not erase the score."""
    responses = iter([None, '{"score": 4, "monitoring_present": [], "monitoring_absent": [], "reasoning": "retry worked"}'])

    async def fake_call_llm(*args, **kwargs):
        return next(responses)

    monkeypatch.setattr(importlib.import_module(main.score_p11.__module__), "call_llm", fake_call_llm)
    result = asyncio.run(main.score_p11(steps=[], protocol_text="Monitor the reaction."))

    assert result.score == 4
    assert result.details["reasoning"] == "retry worked"


def _fake_yield_and_type(*args, **kwargs):
    return {"yield_pct": 90, "reaction_type": "test", "benchmark": {}}


def _fake_async_score(number: int):
    async def score(**kwargs):
        return _score(number)

    return score
