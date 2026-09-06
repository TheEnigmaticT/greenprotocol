"""Offline policy regressions; fake transports never contact a provider."""
import asyncio
import ast
from pathlib import Path

import pytest

import llm_client


def test_isolated_env_never_reaches_legacy_routing(monkeypatch):
    async def forbidden(*args, **kwargs):
        pytest.fail("legacy inference reached")

    monkeypatch.setenv("GCAI_ISOLATED_EXECUTION", "1")
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic-test-key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "synthetic-test-key")
    for name in ("_call_openrouter", "_call_anthropic", "_call_openai_compatible"):
        monkeypatch.setattr(llm_client, name, forbidden)
    with pytest.raises(RuntimeError, match="isolated_policy_missing"):
        asyncio.run(llm_client.call_llm("synthetic"))


def test_scoped_boundary_requires_role_and_verified_model(monkeypatch):
    from isolated_llm_policy import isolated_llm_policy

    calls = []

    async def transport(request):
        calls.append(request)
        return {"model": request.model, "text": "{}", "attempt_id": "a" * 64}

    monkeypatch.setenv("GCAI_ISOLATED_EXECUTION", "1")
    with isolated_llm_policy(model="google/gemma-4-31b-it", source_hash="b" * 64,
                             transport=transport):
        with pytest.raises(RuntimeError, match="isolated_stage_forbidden"):
            asyncio.run(llm_client.call_llm("synthetic"))
        assert asyncio.run(llm_client.call_llm("synthetic", stage="yield")) == "{}"
    assert len(calls) == 1
    assert calls[0].source_hash == "b" * 64
    assert calls[0].stage == "yield"
    with pytest.raises(RuntimeError, match="isolated_model_forbidden"):
        with isolated_llm_policy(model="anthropic/claude-sonnet-4.5", source_hash="b" * 64,
                                 transport=transport):
            pass


def test_returned_identity_failure_and_transport_error_never_fallback(monkeypatch):
    from isolated_llm_policy import isolated_llm_policy

    monkeypatch.setenv("GCAI_ISOLATED_EXECUTION", "1")

    async def wrong_identity(request):
        return {"model": "other/model", "text": "private-output", "attempt_id": "a" * 64}

    with isolated_llm_policy(model="google/gemma-4-31b-it", source_hash="b" * 64,
                             transport=wrong_identity):
        with pytest.raises(RuntimeError, match="isolated_response_invalid"):
            asyncio.run(llm_client.call_llm("synthetic", stage="p8"))

    async def failed(request):
        raise ValueError("private output must not escape")

    with isolated_llm_policy(model="google/gemma-4-31b-it", source_hash="b" * 64,
                             transport=failed):
        with pytest.raises(RuntimeError, match="^isolated_transport_failed$"):
            asyncio.run(llm_client.call_llm("synthetic", stage="p11"))


def test_all_existing_helper_calls_declare_explicit_stage():
    root = Path(__file__).parent
    files = {"yield_extractor.py": "yield", "smiles_extractor.py": "smiles",
             "scoring/p8_reduce_derivatives.py": "p8",
             "scoring/p11_realtime_analysis.py": "p11"}
    for filename, stage in files.items():
        tree = ast.parse((root / filename).read_text())
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Name) and node.func.id == "call_llm"]
        assert calls
        for call in calls:
            assert any(kw.arg == "stage" and isinstance(kw.value, ast.Constant)
                       and kw.value.value == stage for kw in call.keywords)
