"""Lightweight LLM client for surgical, single-purpose calls.

Supports Anthropic Claude API and OpenAI-compatible endpoints (for Qwen).
Used by the scoring service for targeted follow-ups like
"generate reaction SMILES for this protocol."
"""

import asyncio
import logging
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

TIMEOUT = 30.0
QWEN_TIMEOUT = 120.0
QWEN_MAX_TOKENS = 8192
QWEN_MODEL = "qwen/qwen3.8-27b"
OPENROUTER_COMPATIBLE_BASE_URL = "https://openrouter.ai/api/v1"
LEGACY_OPENROUTER_BASE_URL = "https://openrouter.ai/api"
QWEN_MAX_ATTEMPTS = 3
QWEN_RETRY_BACKOFF_SECONDS = (0.25, 0.5)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CompatibleModelRuntime:
    base_url: str
    model: str
    api_key: str


class CandidateConfigurationError(ValueError):
    """A safe configuration failure whose event never embeds configuration values."""

    def __init__(self, event: str):
        super().__init__(event)
        self.event = event


def _configured_value(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def _candidate_engine_selected() -> bool:
    return os.environ.get("GCAI_ENGINE_CANDIDATE") == "1"


def _validate_versioned_compatible_base_url(base_url: str) -> None:
    parsed = urlparse(base_url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.params
        or parsed.query
        or parsed.fragment
        or not parsed.path.endswith("/v1")
    ):
        raise CandidateConfigurationError("candidate_llm_invalid_base_url")


def _resolve_candidate_runtime() -> CompatibleModelRuntime:
    """Resolve the explicit candidate runtime without discovering any provider."""
    base_url = _configured_value("GCAI_LLM_BASE_URL")
    if not base_url:
        raise CandidateConfigurationError("candidate_llm_missing_base_url")
    _validate_versioned_compatible_base_url(base_url)

    model = _configured_value("GCAI_LLM_MODEL")
    if not model:
        raise CandidateConfigurationError("candidate_llm_missing_model")

    api_key = _configured_value("GCAI_LLM_API_KEY")
    if api_key is None and base_url == OPENROUTER_COMPATIBLE_BASE_URL:
        api_key = _configured_value("OPENROUTER_API_KEY")
    if not api_key:
        raise CandidateConfigurationError("candidate_llm_missing_api_key")

    return CompatibleModelRuntime(base_url=base_url, model=model, api_key=api_key)


async def call_llm(prompt: str, system: str = "") -> str | None:
    """Make one text LLM call.

    ``GCAI_ENGINE_CANDIDATE=1`` takes precedence over every legacy provider.
    It requires a versioned compatible endpoint, model, and explicit key; only
    the exact OpenRouter v1 endpoint may use ``OPENROUTER_API_KEY`` as a key
    fallback. Candidate failures return ``None`` rather than discovering or
    falling back to legacy credentials.

    ``GCAI_QWEN_PARITY=1`` preserves the dedicated OpenRouter Qwen route.
    Otherwise, legacy routing remains OpenRouter, explicit local Qwen,
    Anthropic, then a generic local compatible endpoint.
    """
    if _candidate_engine_selected():
        try:
            runtime = _resolve_candidate_runtime()
        except CandidateConfigurationError as error:
            logger.warning(error.event)
            return None
        return await _call_openai_compatible(
            prompt,
            system,
            runtime.base_url,
            runtime.model,
            qwen=True,
            api_key=runtime.api_key,
            versioned_base_url=True,
        )

    if os.environ.get("GCAI_QWEN_PARITY") == "1":
        if not _configured_value("OPENROUTER_API_KEY"):
            logger.warning("qwen_llm_missing_key")
            return None
        return await _call_openai_compatible(
            prompt,
            system,
            LEGACY_OPENROUTER_BASE_URL,
            QWEN_MODEL,
            qwen=True,
        )

    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    local_url = os.environ.get("LOCAL_LLM_URL")
    provider = os.environ.get("LLM_PROVIDER", "").lower()

    if provider == "qwen":
        if not local_url:
            logger.warning("qwen_llm_no_endpoint")
            return None
        model = os.environ.get("LLM_MODEL", QWEN_MODEL)
        return await _call_openai_compatible(prompt, system, local_url, model, qwen=True)

    if openrouter_key:
        return await _call_openrouter(
            prompt,
            system,
            openrouter_key,
            os.environ.get("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5"),
        )

    model = os.environ.get("LLM_MODEL", "claude-sonnet-4-5-20250929")
    if anthropic_key:
        return await _call_anthropic(prompt, system, anthropic_key, model)
    if local_url:
        return await _call_openai_compatible(prompt, system, local_url, model)
    return None


async def _call_openrouter(
    prompt: str, system: str, api_key: str, model: str
) -> str | None:
    """Call a hosted model through OpenRouter's OpenAI-compatible API."""
    base_url = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})
            resp = await client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "max_tokens": 1024,
                    "temperature": 0.0,
                },
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            return data["choices"][0]["message"]["content"]
    except Exception:
        return None


async def _call_anthropic(
    prompt: str, system: str, api_key: str, model: str
) -> str | None:
    """Call Anthropic Claude API."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 1024,
                    "system": system,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            for block in data.get("content", []):
                if block.get("type") == "text":
                    return block["text"]
            return None
    except Exception:
        return None


def _qwen_request_url(base_url: str, versioned_base_url: bool) -> str:
    suffix = "chat/completions" if versioned_base_url else "v1/chat/completions"
    return f"{base_url.rstrip('/')}/{suffix}"


def _is_retryable_http_status(status: int) -> bool:
    return status in {408, 409, 425, 429} or 500 <= status <= 599


def _qwen_log_failure(kind: str, status: int | None = None) -> None:
    if kind == "timeout":
        logger.warning("qwen_llm_timeout")
    elif kind == "http":
        if status is None:
            logger.warning("qwen_llm_http_error")
        else:
            logger.warning("qwen_llm_http_error status=%s", status)
    elif kind == "provider_error":
        logger.warning("qwen_llm_provider_error")
    elif kind == "transport":
        logger.warning("qwen_llm_transport_error")


async def _call_openai_compatible(
    prompt: str,
    system: str,
    base_url: str,
    model: str,
    *,
    qwen: bool = False,
    api_key: str | None = None,
    versioned_base_url: bool = False,
    retry_sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    now: Callable[[], float] = time.monotonic,
    deadline_seconds: float | None = None,
) -> str | None:
    """Call an OpenAI-compatible endpoint (Qwen, vLLM, etc.).

    Qwen calls use at most three attempts at the same endpoint. Only transient
    statuses/transport failures and OpenRouter's ``finish_reason=error``
    envelope retry. The helper logs event names only, never prompt, system,
    endpoint, key, or provider response content.
    """
    timeout = QWEN_TIMEOUT if qwen else TIMEOUT
    max_tokens = QWEN_MAX_TOKENS if qwen else 1024
    deadline = deadline_seconds if deadline_seconds is not None else timeout
    request_url = _qwen_request_url(base_url, versioned_base_url)
    is_openrouter = (
        base_url == OPENROUTER_COMPATIBLE_BASE_URL
        if versioned_base_url
        else base_url == LEGACY_OPENROUTER_BASE_URL
    )

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.0,
    }
    headers = {"content-type": "application/json"}

    if qwen:
        # Qwen3 otherwise may spend the response budget on reasoning before
        # emitting the strict JSON/SMILES text requested by these helpers.
        payload["enable_thinking"] = False
    if is_openrouter:
        resolved_key = api_key or _configured_value("OPENROUTER_API_KEY")
        if not resolved_key:
            if qwen:
                logger.warning("qwen_llm_missing_key")
            return None
        headers["Authorization"] = "Bearer " + resolved_key
        payload.pop("enable_thinking", None)
        payload["reasoning"] = {"enabled": False}
    elif api_key:
        headers["Authorization"] = "Bearer " + api_key

    attempts = QWEN_MAX_ATTEMPTS if qwen else 1
    started_at = now()
    try:
        async with asyncio.timeout(deadline if qwen else None), httpx.AsyncClient(timeout=timeout) as client:
            for attempt in range(attempts):
                retryable = False
                failure_kind = "transport"
                failure_status: int | None = None
                try:
                    resp = await client.post(request_url, headers=headers, json=payload)
                except httpx.TimeoutException:
                    retryable = qwen
                    failure_kind = "timeout"
                except httpx.TransportError:
                    retryable = qwen
                    failure_kind = "transport"
                except httpx.HTTPError:
                    if qwen:
                        logger.warning("qwen_llm_http_error")
                    return None
                else:
                    if resp.status_code != 200:
                        failure_status = resp.status_code
                        failure_kind = "http"
                        retryable = qwen and _is_retryable_http_status(resp.status_code)
                        if not retryable:
                            if qwen:
                                _qwen_log_failure(failure_kind, failure_status)
                            return None
                    else:
                        try:
                            data = resp.json()
                            choices = data.get("choices", [])
                            if not choices:
                                if qwen:
                                    logger.warning("qwen_llm_no_response")
                                return None
                            choice = choices[0]
                        except (TypeError, ValueError, AttributeError, IndexError):
                            if qwen:
                                logger.warning("qwen_llm_parse_failed")
                            return None

                        if choice.get("finish_reason") == "error":
                            retryable = qwen
                            failure_kind = "provider_error"
                        elif choice.get("finish_reason") == "length":
                            if qwen:
                                logger.warning("qwen_llm_truncated_response")
                            return None
                        else:
                            content = choice.get("message", {}).get("content")
                            if not isinstance(content, str) or not content.strip():
                                if qwen:
                                    logger.warning("qwen_llm_no_response")
                                return None
                            return content

                if not retryable:
                    if qwen:
                        _qwen_log_failure(failure_kind, failure_status)
                    return None
                if attempt + 1 >= attempts:
                    _qwen_log_failure(failure_kind, failure_status)
                    return None

                delay = QWEN_RETRY_BACKOFF_SECONDS[min(attempt, len(QWEN_RETRY_BACKOFF_SECONDS) - 1)]
                if now() - started_at + delay > deadline:
                    logger.warning("qwen_llm_retry_deadline_exceeded")
                    return None
                await retry_sleep(delay)
    except (asyncio.TimeoutError, TimeoutError):
        if qwen:
            logger.warning("qwen_llm_timeout")
        return None
    except Exception:
        if qwen:
            logger.warning("qwen_llm_transport_error")
        return None

    return None
