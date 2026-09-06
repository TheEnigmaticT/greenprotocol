"""Lightweight LLM client for surgical, single-purpose calls.

Supports Anthropic Claude API and OpenAI-compatible endpoints (for Qwen).
Used by the scoring service for targeted follow-ups like
"generate reaction SMILES for this protocol."
"""

import os
import httpx
from isolated_llm_policy import isolated_execution_active, call_isolated_llm

TIMEOUT = 30.0


async def call_local_helper(request) -> dict:
    """One bounded Ollama attempt; no redirects, proxies, keys or fallback.

    Native chat contract: https://docs.ollama.com/api/chat. Model identifiers
    are the exact operator-supplied installed artifacts, never aliases.
    """
    import hashlib
    import json
    import uuid
    from isolated_llm_policy import LOCAL_MODELS, APPROVED_STAGES
    if request.model not in LOCAL_MODELS or request.stage not in APPROVED_STAGES:
        raise RuntimeError("local_helper_forbidden")
    if len((request.prompt + request.system).encode()) > 131072:
        raise RuntimeError("local_helper_input_oversized")
    async with httpx.AsyncClient(timeout=60.0, trust_env=False, follow_redirects=False) as client:
        async with client.stream("POST", "http://127.0.0.1:11434/api/chat", json={
            "model": request.model,
            "messages": [{"role": "system", "content": request.system},
                         {"role": "user", "content": request.prompt}],
            "stream": False, "think": False, "keep_alive": "5m",
            "options": {"temperature": 0, "num_predict": 2048, "num_ctx": 32768},
        }) as response:
            if response.status_code != 200:
                raise RuntimeError("local_helper_http_failed")
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > 262144:
                    raise RuntimeError("local_helper_output_oversized")
    data = json.loads(body)
    if (data.get("model") != request.model or data.get("done") is not True
            or data.get("done_reason") != "stop"
            or data.get("message", {}).get("role") != "assistant"
            or data.get("message", {}).get("tool_calls")):
        raise RuntimeError("local_helper_response_invalid")
    return {"model": request.model, "text": data["message"]["content"],
            "attempt_id": hashlib.sha256(uuid.uuid4().bytes).hexdigest()}


async def call_llm(prompt: str, system: str = "", *, stage: str | None = None) -> str | None:
    """Make a single LLM call and return the text response.
    
    Checks for providers in order:
    1. OPENROUTER_API_KEY -> OpenRouter's OpenAI-compatible API
    2. ANTHROPIC_API_KEY -> Anthropic Claude API
    3. LOCAL_LLM_URL -> OpenAI-compatible endpoint (Qwen, etc.)

    Legacy routing returns None if no provider is configured or a call fails.
    Isolated routing raises policy errors and preserves cancellation; callers
    must never catch these errors to invoke a legacy fallback.
    """
    if isolated_execution_active():
        return await call_isolated_llm(prompt, system, stage)

    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    local_url = os.environ.get("LOCAL_LLM_URL")
    model = os.environ.get("LLM_MODEL", "claude-sonnet-4-5-20250929")

    if openrouter_key:
        return await _call_openrouter(
            prompt,
            system,
            openrouter_key,
            os.environ.get("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5"),
        )
    if anthropic_key:
        return await _call_anthropic(prompt, system, anthropic_key, model)
    elif local_url:
        return await _call_openai_compatible(prompt, system, local_url, model)
    else:
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


async def _call_openai_compatible(
    prompt: str, system: str, base_url: str, model: str
) -> str | None:
    """Call an OpenAI-compatible endpoint (Qwen, vLLM, etc.)."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})

            resp = await client.post(
                f"{base_url.rstrip('/')}/v1/chat/completions",
                headers={"content-type": "application/json"},
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
