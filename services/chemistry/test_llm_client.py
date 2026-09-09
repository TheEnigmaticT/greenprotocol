import asyncio

import pytest

import llm_client


@pytest.fixture(autouse=True)
def _isolate_llm_environment_and_forbid_unmocked_http(monkeypatch):
    for name in (
        "GCAI_ENGINE_CANDIDATE",
        "GCAI_LLM_BASE_URL",
        "GCAI_LLM_MODEL",
        "GCAI_LLM_API_KEY",
        "GCAI_QWEN_PARITY",
        "LLM_PROVIDER",
        "LLM_MODEL",
        "LOCAL_LLM_URL",
        "OPENROUTER_API_KEY",
        "OPENROUTER_BASE_URL",
        "OPENROUTER_MODEL",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
    ):
        monkeypatch.delenv(name, raising=False)

    def unmocked_async_client(*args, **kwargs):
        raise AssertionError("real HTTP is forbidden in llm client tests")

    monkeypatch.setattr(llm_client.httpx, "AsyncClient", unmocked_async_client)


def test_call_llm_prefers_openrouter_for_chemistry_scoring(monkeypatch):
    calls = {}

    async def fake_openrouter(prompt, system, api_key, model):
        calls.update(prompt=prompt, system=system, api_key=api_key, model=model)
        return '{"ok": true}'

    monkeypatch.setenv("OPENROUTER_API_KEY", "openrouter-test-key")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("LOCAL_LLM_URL", raising=False)
    monkeypatch.delenv("OPENROUTER_MODEL", raising=False)
    monkeypatch.setattr(llm_client, "_call_openrouter", fake_openrouter)

    result = asyncio.run(llm_client.call_llm("classify this", system="return JSON"))

    assert result == '{"ok": true}'
    assert calls == {
        "prompt": "classify this",
        "system": "return JSON",
        "api_key": "openrouter-test-key",
        "model": "anthropic/claude-sonnet-4.5",
    }


def test_openrouter_model_can_be_overridden(monkeypatch):
    calls = {}

    async def fake_openrouter(prompt, system, api_key, model):
        calls["model"] = model
        return "ok"

    monkeypatch.setenv("OPENROUTER_API_KEY", "openrouter-test-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "anthropic/claude-opus-4.5")
    monkeypatch.setattr(llm_client, "_call_openrouter", fake_openrouter)

    assert asyncio.run(llm_client.call_llm("classify this")) == "ok"
    assert calls["model"] == "anthropic/claude-opus-4.5"
