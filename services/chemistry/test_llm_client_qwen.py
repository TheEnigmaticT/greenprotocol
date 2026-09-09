"""Regression coverage for compatible-model transport selection and failures."""

import asyncio
import logging

import httpx
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


class _FakeClient:
    def __init__(self, response=None, error=None, responses=None, **kwargs):
        self.response = response
        self.error = error
        self.responses = list(responses) if responses is not None else None
        self.request = None
        self.requests = []
        self.timeout = kwargs.get("timeout")

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, url, headers, json):
        self.request = {"url": url, "headers": headers, "json": json}
        self.requests.append(self.request)
        if self.responses is not None:
            item = self.responses.pop(0)
            if isinstance(item, Exception):
                raise item
            return item
        if self.error:
            raise self.error
        return self.response


def _install_client(monkeypatch, response=None, error=None, responses=None):
    client = _FakeClient(response=response, error=error, responses=responses)

    def fake_async_client(**kwargs):
        client.timeout = kwargs.get("timeout")
        return client

    monkeypatch.setattr(llm_client.httpx, "AsyncClient", fake_async_client)
    return client


def _success(content='{"score": 3}'):
    return httpx.Response(200, json={
        "choices": [{"finish_reason": "stop", "message": {"content": content}}],
    })


def test_candidate_uses_only_explicit_local_endpoint_model_and_key(monkeypatch):
    monkeypatch.setenv("GCAI_ENGINE_CANDIDATE", "1")
    monkeypatch.setenv("GCAI_LLM_BASE_URL", "http://127.0.0.1:8080/v1")
    monkeypatch.setenv("GCAI_LLM_MODEL", "local/qwen-candidate")
    monkeypatch.setenv("GCAI_LLM_API_KEY", "candidate-test-key")
    monkeypatch.setenv("OPENROUTER_API_KEY", "must-not-be-selected")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "must-not-be-selected")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-be-selected")
    client = _install_client(monkeypatch, response=_success())

    async def forbidden_anthropic(*args, **kwargs):
        raise AssertionError("candidate selection must not call Anthropic")

    monkeypatch.setattr(llm_client, "_call_anthropic", forbidden_anthropic)
    assert asyncio.run(llm_client.call_llm("original prompt", "original system")) == '{"score": 3}'
    assert client.request["url"] == "http://127.0.0.1:8080/v1/chat/completions"
    assert client.request["headers"]["Authorization"] == "Bearer candidate-test-key"
    assert client.request["json"]["model"] == "local/qwen-candidate"
    assert client.request["json"]["enable_thinking"] is False
    assert "reasoning" not in client.request["json"]


def test_candidate_openrouter_key_fallback_requires_exact_explicit_v1_endpoint(monkeypatch):
    monkeypatch.setenv("GCAI_ENGINE_CANDIDATE", "1")
    monkeypatch.setenv("GCAI_LLM_BASE_URL", "https://openrouter.ai/api/v1")
    monkeypatch.setenv("GCAI_LLM_MODEL", "qwen/qwen3.8-27b")
    monkeypatch.setenv("OPENROUTER_API_KEY", "openrouter-fallback-key")
    client = _install_client(monkeypatch, response=_success())

    assert asyncio.run(llm_client.call_llm("prompt", "system")) == '{"score": 3}'
    assert client.request["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert client.request["headers"]["Authorization"] == "Bearer openrouter-fallback-key"
    assert client.request["json"]["reasoning"] == {"enabled": False}
    assert "enable_thinking" not in client.request["json"]


@pytest.mark.parametrize(
    ("base_url", "model", "expected_event"),
    [
        (None, "local/qwen-candidate", "candidate_llm_missing_base_url"),
        ("http://127.0.0.1:8080/v1", None, "candidate_llm_missing_model"),
        ("http://127.0.0.1:8080/v1", "local/qwen-candidate", "candidate_llm_missing_api_key"),
    ],
)
def test_candidate_missing_configuration_returns_none_without_fallback(monkeypatch, caplog, base_url, model, expected_event):
    monkeypatch.setenv("GCAI_ENGINE_CANDIDATE", "1")
    if base_url is not None:
        monkeypatch.setenv("GCAI_LLM_BASE_URL", base_url)
    if model is not None:
        monkeypatch.setenv("GCAI_LLM_MODEL", model)
    monkeypatch.setenv("OPENROUTER_API_KEY", "must-not-be-selected-for-local")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "must-not-be-selected")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-be-selected")

    async def forbidden_anthropic(*args, **kwargs):
        raise AssertionError("candidate selection must not call Anthropic")

    async def forbidden_compatible(*args, **kwargs):
        raise AssertionError("invalid candidate configuration must not call a compatible endpoint")

    monkeypatch.setattr(llm_client, "_call_anthropic", forbidden_anthropic)
    monkeypatch.setattr(llm_client, "_call_openai_compatible", forbidden_compatible)
    with caplog.at_level(logging.WARNING):
        assert asyncio.run(llm_client.call_llm("secret protocol text", "secret system")) is None

    assert expected_event in caplog.text
    assert "secret protocol text" not in caplog.text
    assert "secret system" not in caplog.text


def test_candidate_rejects_non_versioned_endpoint_without_implicit_openrouter(monkeypatch, caplog):
    monkeypatch.setenv("GCAI_ENGINE_CANDIDATE", "1")
    monkeypatch.setenv("GCAI_LLM_BASE_URL", "https://openrouter.ai/api")
    monkeypatch.setenv("GCAI_LLM_MODEL", "qwen/qwen3.8-27b")
    monkeypatch.setenv("OPENROUTER_API_KEY", "must-not-be-selected")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "must-not-be-selected")

    async def forbidden(*args, **kwargs):
        raise AssertionError("invalid candidate configuration must not use another provider")

    monkeypatch.setattr(llm_client, "_call_anthropic", forbidden)
    monkeypatch.setattr(llm_client, "_call_openai_compatible", forbidden)
    with caplog.at_level(logging.WARNING):
        assert asyncio.run(llm_client.call_llm("prompt")) is None

    assert "candidate_llm_invalid_base_url" in caplog.text


def test_parity_mode_uses_authenticated_openrouter_and_disables_reasoning(monkeypatch):
    monkeypatch.setenv("GCAI_QWEN_PARITY", "1")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only-key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "must-not-be-used")
    client = _install_client(monkeypatch, response=_success())

    assert asyncio.run(llm_client.call_llm("original prompt", "original system")) == '{"score": 3}'
    assert client.request["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert client.request["headers"]["Authorization"] == "Bearer test-only-key"
    assert client.request["json"]["model"] == "qwen/qwen3.8-27b"
    assert client.request["json"]["reasoning"] == {"enabled": False}
    assert client.request["json"]["messages"] == [{"role": "system", "content": "original system"}, {"role": "user", "content": "original prompt"}]


def test_parity_missing_key_does_not_call_anthropic(monkeypatch):
    monkeypatch.setenv("GCAI_QWEN_PARITY", "1")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "must-not-be-used")

    async def forbidden(*args, **kwargs):
        raise AssertionError("No Anthropic fallback")

    monkeypatch.setattr(llm_client, "_call_anthropic", forbidden)
    assert asyncio.run(llm_client.call_llm("prompt")) is None


@pytest.mark.parametrize(
    ("candidate_enabled", "provider", "expected_route"),
    [
        (True, "qwen", "candidate"),
        (False, "qwen", "qwen"),
        (False, None, "openrouter"),
    ],
)
def test_provider_selection_matrix_with_all_provider_values_set(
    monkeypatch, candidate_enabled, provider, expected_route
):
    for name, value in {
        "GCAI_LLM_BASE_URL": "http://candidate/v1",
        "GCAI_LLM_MODEL": "candidate-model",
        "GCAI_LLM_API_KEY": "candidate-key",
        "LOCAL_LLM_URL": "http://local-qwen",
        "LLM_MODEL": "local-qwen-model",
        "OPENROUTER_API_KEY": "openrouter-key",
        "OPENROUTER_BASE_URL": "http://openrouter-override",
        "OPENROUTER_MODEL": "openrouter-model",
        "ANTHROPIC_API_KEY": "anthropic-key",
        "OPENAI_API_KEY": "openai-key",
    }.items():
        monkeypatch.setenv(name, value)
    if candidate_enabled:
        monkeypatch.setenv("GCAI_ENGINE_CANDIDATE", "1")
    if provider is not None:
        monkeypatch.setenv("LLM_PROVIDER", provider)

    calls = []

    async def fake_compatible(prompt, system, base_url, model, **kwargs):
        calls.append(("compatible", base_url, model, kwargs))
        return "compatible response"

    async def fake_openrouter(prompt, system, api_key, model):
        calls.append(("openrouter", api_key, model))
        return "openrouter response"

    async def forbidden_openrouter(*args, **kwargs):
        raise AssertionError("explicit Qwen must not call OpenRouter")

    async def forbidden_anthropic(*args, **kwargs):
        raise AssertionError("matrix selection must not call Anthropic")

    monkeypatch.setattr(llm_client, "_call_openai_compatible", fake_compatible)
    monkeypatch.setattr(llm_client, "_call_anthropic", forbidden_anthropic)
    monkeypatch.setattr(
        llm_client,
        "_call_openrouter",
        fake_openrouter if expected_route == "openrouter" else forbidden_openrouter,
    )

    result = asyncio.run(llm_client.call_llm("prompt", "system"))

    if expected_route == "candidate":
        assert result == "compatible response"
        assert calls == [
            ("compatible", "http://candidate/v1", "candidate-model", {
                "qwen": True,
                "api_key": "candidate-key",
                "versioned_base_url": True,
            })
        ]
    elif expected_route == "qwen":
        assert result == "compatible response"
        assert calls == [
            ("compatible", "http://local-qwen", "local-qwen-model", {"qwen": True})
        ]
    else:
        assert result == "openrouter response"
        assert calls == [("openrouter", "openrouter-key", "openrouter-model")]


def test_qwen_retries_same_endpoint_after_transient_callback_error(monkeypatch):
    client = _install_client(monkeypatch, responses=[
        httpx.Response(429, json={"error": {"message": "not logged"}}),
        _success(),
    ])
    delays = []

    async def fake_sleep(seconds):
        delays.append(seconds)

    result = asyncio.run(llm_client._call_openai_compatible(
        "prompt", "system", "http://qwen/v1", "qwen/qwen3.8-27b",
        qwen=True, api_key="test-key", versioned_base_url=True, retry_sleep=fake_sleep, now=lambda: 0.0,
    ))

    assert result == '{"score": 3}'
    assert len(client.requests) == 2
    assert client.requests[0]["url"] == client.requests[1]["url"] == "http://qwen/v1/chat/completions"
    assert client.requests[0]["json"] == client.requests[1]["json"]
    assert delays == [0.25]


def test_qwen_retries_openrouter_provider_error_envelope_and_ignores_content(monkeypatch):
    client = _install_client(monkeypatch, responses=[
        httpx.Response(200, json={"choices": [{
            "finish_reason": "error",
            "message": {"content": '{"score": "untrustworthy"}'},
        }]}),
        _success(),
    ])
    delays = []

    async def fake_sleep(seconds):
        delays.append(seconds)

    result = asyncio.run(llm_client._call_openai_compatible(
        "prompt", "", "https://openrouter.ai/api/v1", "qwen/qwen3.8-27b",
        qwen=True, api_key="test-key", versioned_base_url=True, retry_sleep=fake_sleep, now=lambda: 0.0,
    ))

    assert result == '{"score": 3}'
    assert len(client.requests) == 2
    assert delays == [0.25]


def test_qwen_retry_deadline_prevents_additional_callback(monkeypatch, caplog):
    client = _install_client(monkeypatch, response=httpx.Response(429, json={"error": {}}))
    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    with caplog.at_level(logging.WARNING):
        result = asyncio.run(llm_client._call_openai_compatible(
            "secret protocol text", "secret system", "http://qwen/v1", "qwen/qwen3.8-27b",
            qwen=True, api_key="test-key", versioned_base_url=True,
            retry_sleep=fake_sleep, now=lambda: 0.0, deadline_seconds=0.1,
        ))

    assert result is None
    assert len(client.requests) == 1
    assert sleeps == []
    assert "qwen_llm_retry_deadline_exceeded" in caplog.text
    assert "secret protocol text" not in caplog.text
    assert "secret system" not in caplog.text


def test_qwen_truncated_malformed_and_wrong_tool_text_completions_are_rejected(monkeypatch, caplog):
    client = _install_client(monkeypatch, responses=[
        httpx.Response(200, json={"choices": [{"finish_reason": "length", "message": {"content": "partial"}}]}),
        httpx.Response(200, content=b"not json"),
        httpx.Response(200, json={"choices": [{"finish_reason": "tool_calls", "message": {"tool_calls": [{"function": {"name": "other"}}]}}]}),
    ])

    with caplog.at_level(logging.WARNING):
        for _ in range(3):
            assert asyncio.run(llm_client._call_openai_compatible(
                "prompt", "", "http://qwen/v1", "qwen/qwen3.8-27b",
                qwen=True, api_key="test-key", versioned_base_url=True,
                retry_sleep=lambda _: asyncio.sleep(0),
            )) is None

    assert "qwen_llm_truncated_response" in caplog.text
    assert "qwen_llm_parse_failed" in caplog.text
    assert "qwen_llm_no_response" in caplog.text


def test_qwen_timeout_is_distinguished_without_request_contents(monkeypatch, caplog):
    _install_client(monkeypatch, error=httpx.ReadTimeout("timed out"))

    async def fake_sleep(_):
        return None

    with caplog.at_level(logging.WARNING):
        result = asyncio.run(llm_client._call_openai_compatible(
            "secret protocol text", "secret system", "http://qwen", "qwen/qwen3.8-27b",
            qwen=True, retry_sleep=fake_sleep,
        ))

    assert result is None
    assert "qwen_llm_timeout" in caplog.text
    assert "secret protocol text" not in caplog.text
    assert "secret system" not in caplog.text


def test_legacy_routing_stays_anthropic_first_without_qwen_opt_in(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.setenv("LOCAL_LLM_URL", "http://qwen")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "legacy-key")
    called = {"anthropic": None}

    async def fake_anthropic(prompt, system, key, model):
        called["anthropic"] = (key, model)
        return "legacy response"

    async def qwen_should_not_run(*args, **kwargs):
        raise AssertionError("legacy Anthropic-first routing changed")

    monkeypatch.setattr(llm_client, "_call_anthropic", fake_anthropic)
    monkeypatch.setattr(llm_client, "_call_openai_compatible", qwen_should_not_run)

    assert asyncio.run(llm_client.call_llm("prompt")) == "legacy response"
    assert called["anthropic"] == ("legacy-key", "claude-sonnet-4-5-20250929")


def test_explicit_legacy_qwen_never_falls_back_to_anthropic(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "qwen")
    monkeypatch.setenv("LOCAL_LLM_URL", "http://qwen")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "present-but-not-used")
    called = {"qwen": None}

    async def anthropic_should_not_run(*args, **kwargs):
        raise AssertionError("Anthropic fallback is forbidden for explicit Qwen")

    async def fake_qwen(prompt, system, url, model, *, qwen=False, **kwargs):
        called["qwen"] = (url, model, qwen)
        return "qwen response"

    monkeypatch.setattr(llm_client, "_call_anthropic", anthropic_should_not_run)
    monkeypatch.setattr(llm_client, "_call_openai_compatible", fake_qwen)

    assert asyncio.run(llm_client.call_llm("prompt")) == "qwen response"
    assert called["qwen"] == ("http://qwen", "qwen/qwen3.8-27b", True)
