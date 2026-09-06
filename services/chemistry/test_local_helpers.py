"""Offline service/transport integration: real helpers and deterministic scoring."""
import asyncio
import json
import socket

import httpx
import pytest
from fastapi.testclient import TestClient
import main
import llm_client
from test_isolated_helper_runner import TEXT, CHEMICAL, STEPS, RESPONSES

REAL_ASYNC_CLIENT = httpx.AsyncClient

MODELS = ["hf.co/bartowski/google_gemma-4-31B-it-GGUF:Q5_K_M", "hf.co/unsloth/Qwen3.8-27B-GGUF:Q4_K_M"]

@pytest.fixture(autouse=True)
def offline(monkeypatch):
    def forbidden(*a, **kw):
        pytest.fail("unexpected network/legacy provider")
    monkeypatch.setattr(socket.socket, "connect", forbidden)
    for name in ("_call_openrouter", "_call_anthropic", "_call_openai_compatible"):
        monkeypatch.setattr(llm_client, name, forbidden)
    monkeypatch.setenv("GCAI_LOCAL_HELPERS", "1")
    monkeypatch.setenv("GCAI_LOCAL_HELPER_MODEL", MODELS[0])
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "synthetic")
    monkeypatch.delenv("CHEMISTRY_SERVICE_TOKEN", raising=False)


def mock_ollama(monkeypatch, model, bad=None):
    calls = []

    def handler(request):
        payload = json.loads(request.content)
        stage = ["yield", "smiles", "p8", "p11"][len(calls)]
        calls.append(payload)
        assert str(request.url) == "http://127.0.0.1:11434/api/chat"
        assert "authorization" not in request.headers
        assert payload["model"] == model
        assert payload["stream"] is False
        assert payload["options"]["num_predict"] == 2048
        data = {"model": model, "done": True, "done_reason": "stop", "message": {"role": "assistant", "content": RESPONSES[stage]}}
        if bad == "schema" and stage == "p11":
            data["message"]["content"] = "{}"
        elif bad == "identity":
            data["model"] = "wrong"
        elif bad == "truncated":
            data["done_reason"] = "length"
        elif bad == "redirect":
            return httpx.Response(307, headers={"location": "https://forbidden.invalid"})
        elif bad == "timeout":
            raise httpx.ReadTimeout("synthetic", request=request)
        elif bad == "oversized":
            return httpx.Response(200, content=b"x" * 262145)
        return httpx.Response(200, json=data)
    def factory(**kwargs):
        assert kwargs["trust_env"] is False
        assert kwargs["follow_redirects"] is False
        return REAL_ASYNC_CLIENT(**kwargs, transport=httpx.MockTransport(handler))
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", factory)
    return calls


def score():
    return TestClient(main.app).post("/score", json={"protocol_text": TEXT, "steps": STEPS, "chemicals": [{**CHEMICAL, "quantity_g": 3.9}]})

@pytest.mark.parametrize("model", MODELS)
def test_service_runs_actual_helpers_local_only(monkeypatch, model):
    monkeypatch.setenv("GCAI_LOCAL_HELPER_MODEL", model)
    calls = mock_ollama(monkeypatch, model)
    response = score()
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(calls) == 4
    scores = {s["principle_number"]: s for s in data["scores"]}
    assert scores[8]["score"] == 10
    assert scores[11]["score"] == 5
    assert scores[11]["confidence"] == "model-inferred"
    assert data["local_helpers"]["model"] == model
    assert scores[2]["details"]["atom_economy_pct"] == 100

@pytest.mark.parametrize("bad", ["schema", "identity", "truncated", "redirect", "timeout", "oversized"])
def test_bad_local_responses_are_unavailable_not_defaults(monkeypatch, bad):
    mock_ollama(monkeypatch, MODELS[0], bad)
    response = score()
    assert response.status_code == 200
    data = response.json()
    assert data["scores"][10]["score"] == -1
    assert data["local_helpers"]["helpers"]["p11"]["status"] == "unavailable"

@pytest.mark.parametrize("key,value", [("GCAI_LOCAL_HELPERS", "true"), ("GCAI_LOCAL_HELPER_MODEL", "google/gemma-4-31b-it"), ("GCAI_LOCAL_HELPER_MODEL", "")])
def test_invalid_opt_in_fails_closed(monkeypatch, key, value):
    monkeypatch.setenv(key, value)
    assert score().status_code == 503


def test_direct_helper_cannot_escape_local_policy():
    with pytest.raises(RuntimeError, match="isolated_policy_missing"):
        asyncio.run(llm_client.call_llm("test", stage="yield"))


def test_unanchored_steps_rejected_before_transport():
    response = TestClient(main.app).post("/score", json={"protocol_text": TEXT, "steps": [], "chemicals": [CHEMICAL]})
    assert response.status_code == 422


def test_local_failure_does_not_change_other_deterministic_scores(monkeypatch):
    mock_ollama(monkeypatch, MODELS[0])
    good = score().json()
    mock_ollama(monkeypatch, MODELS[0], "schema")
    bad = score().json()
    assert good["scores"][:10] == bad["scores"][:10]
    assert good["scores"][11] == bad["scores"][11]
    assert good["waste_analysis"] == bad["waste_analysis"]
