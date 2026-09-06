"""Fail-closed helper boundary for the isolated qualification workflow.

No network or credentials here. The caller supplies the independently reviewed
mission transport, responsible for reservations, attempts and semantic validation.
This module alone is not live helper qualification or a spend ledger.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import asyncio
import os
import re
from typing import Awaitable, Callable


# Verified prior source and official catalog; no family/prefix matching.
LOCAL_MODELS = frozenset({
    "hf.co/bartowski/google_gemma-4-31B-it-GGUF:Q5_K_M",
    "hf.co/unsloth/Qwen3.8-27B-GGUF:Q4_K_M",
})
APPROVED_MODELS = frozenset({"google/gemma-4-31b-it"}) | LOCAL_MODELS
APPROVED_STAGES = frozenset({"yield", "smiles", "p8", "p11"})
_HASH = re.compile(r"[0-9a-f]{64}\Z")


@dataclass(frozen=True)
class HelperRequest:
    model: str
    stage: str
    source_hash: str
    prompt: str
    system: str


@dataclass(frozen=True)
class _Policy:
    model: str
    source_hash: str
    transport: Callable[[HelperRequest], Awaitable[dict]]


_policy: ContextVar[_Policy | None] = ContextVar("isolated_helper_policy", default=None)


def isolated_execution_active() -> bool:
    # Any nonempty value is fail-closed, including misspelled truthy values.
    return bool(os.environ.get("GCAI_ISOLATED_EXECUTION") or os.environ.get("GCAI_LOCAL_HELPERS")) or _policy.get() is not None


def helper_protocol_context(protocol_text: str, legacy_limit: int) -> str:
    """Isolated/local calls retain the whole source or fail the transport bound.

    Preserve legacy routing behavior until its separate retirement approval.
    """
    return protocol_text if isolated_execution_active() else protocol_text[:legacy_limit]


@contextmanager
def isolated_llm_policy(*, model: str, source_hash: str,
                        transport: Callable[[HelperRequest], Awaitable[dict]]):
    if model not in APPROVED_MODELS:
        raise RuntimeError("isolated_model_forbidden")
    if not isinstance(source_hash, str) or not _HASH.fullmatch(source_hash):
        raise RuntimeError("isolated_source_invalid")
    if not callable(transport):
        raise RuntimeError("isolated_transport_invalid")
    token = _policy.set(_Policy(model, source_hash, transport))
    try:
        yield
    finally:
        _policy.reset(token)


async def call_isolated_llm(prompt: str, system: str, stage: str | None) -> str:
    policy = _policy.get()
    if policy is None:
        raise RuntimeError("isolated_policy_missing")
    if stage not in APPROVED_STAGES:
        raise RuntimeError("isolated_stage_forbidden")
    if not isinstance(prompt, str) or not isinstance(system, str):
        raise RuntimeError("isolated_input_invalid")
    if len((prompt + system).encode("utf-8")) > 131072:
        raise RuntimeError("isolated_input_oversized")
    try:
        result = await asyncio.wait_for(policy.transport(HelperRequest(
            policy.model, stage, policy.source_hash, prompt, system)), timeout=120)
    except Exception:
        raise RuntimeError("isolated_transport_failed") from None
    if (not isinstance(result, dict) or set(result) != {"model", "text", "attempt_id"}
            or result.get("model") != policy.model
            or not isinstance(result.get("attempt_id"), str)
            or not _HASH.fullmatch(result["attempt_id"])
            or not isinstance(result.get("text"), str)
            or not result["text"].strip()
            or len(result["text"].encode("utf-8")) > 131072):
        raise RuntimeError("isolated_response_invalid")
    return result["text"]
