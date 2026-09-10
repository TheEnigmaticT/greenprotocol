"""Yield extraction must be grounded in quoted protocol evidence."""

import asyncio
import yield_extractor


def test_extractor_rejects_model_claimed_stated_values_absent_from_protocol(monkeypatch) -> None:
    async def response(*args, **kwargs):
        return '{"yield_pct": 80, "yield_mass_g": 4, "reaction_type": "amide_coupling", "confidence": "stated"}'
    monkeypatch.setattr(yield_extractor, "call_llm", response)
    result = asyncio.run(yield_extractor.extract_yield_and_type("The residue was dried."))
    assert result["yield_pct"] is None
    assert result["yield_mass_g"] is None
    assert result["confidence"] == "unknown"
    assert result["yield_evidence_status"] == "unsupported_by_protocol"


def test_extractor_keeps_only_values_with_exact_protocol_evidence(monkeypatch) -> None:
    async def response(*args, **kwargs):
        return '{"yield_pct": 80, "yield_mass_g": 4, "reaction_type": "amide_coupling", "confidence": "stated"}'
    monkeypatch.setattr(yield_extractor, "call_llm", response)
    result = asyncio.run(yield_extractor.extract_yield_and_type("The isolated product weighed 4 g (80% yield)."))
    assert result["yield_pct"] == 80.0
    assert result["yield_mass_g"] == 4.0
    assert result["yield_evidence"] == {"yield_pct": "80% yield", "yield_mass_g": "4 g"}


def test_extractor_rejects_out_of_bounds_stated_values(monkeypatch) -> None:
    async def response(*args, **kwargs):
        return '{"yield_pct": 140, "yield_mass_g": -4, "reaction_type": "amide_coupling", "confidence": "stated"}'
    monkeypatch.setattr(yield_extractor, "call_llm", response)
    result = asyncio.run(yield_extractor.extract_yield_and_type("Yield was 140%; isolated mass was -4 g."))
    assert result["yield_pct"] is None
    assert result["yield_mass_g"] is None
    assert result["yield_evidence_status"] == "invalid_stated_value"
