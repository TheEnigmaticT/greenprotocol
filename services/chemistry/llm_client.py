"""Lightweight LLM client for surgical, single-purpose calls.

Supports Anthropic Claude API and OpenAI-compatible endpoints (for Qwen).
Used by the scoring service for targeted follow-ups like
"generate reaction SMILES for this protocol."
"""

import os
import httpx

TIMEOUT = 30.0


async def call_llm(prompt: str, system: str = "") -> str | None:
    """Make a single LLM call and return the text response.
    
    Checks for providers in order:
    1. ANTHROPIC_API_KEY -> Claude API
    2. LOCAL_LLM_URL -> OpenAI-compatible endpoint (Qwen, etc.)
    
    Returns None if no provider is configured or call fails.
    """
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    local_url = os.environ.get("LOCAL_LLM_URL")
    model = os.environ.get("LLM_MODEL", "claude-sonnet-4-5-20250929")

    if anthropic_key:
        return await _call_anthropic(prompt, system, anthropic_key, model)
    elif local_url:
        return await _call_openai_compatible(prompt, system, local_url, model)
    else:
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
