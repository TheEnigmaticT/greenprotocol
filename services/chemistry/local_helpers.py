"""Opt-in service adapter. All helper values pass the frozen runner contracts."""
import asyncio
import hashlib
import os
from fastapi import HTTPException
from isolated_helper_runner import run_helpers
from isolated_llm_policy import LOCAL_MODELS
from llm_client import call_local_helper
from scoring.models import PrincipleScore, ScoreProvenance


async def run_local_helpers(request):
    model = os.getenv("GCAI_LOCAL_HELPER_MODEL")
    if os.getenv("GCAI_LOCAL_HELPERS") != "1" or model not in LOCAL_MODELS:
        raise HTTPException(503, "local_helper_configuration_invalid")
    # Six callbacks max: yield, SMILES (+ validation retry), P8 (+ schema repair), P11.
    attempts = 0
    async def transport(helper_request):
        nonlocal attempts
        attempts += 1
        if attempts > 6:
            raise RuntimeError("local_helper_budget_exhausted")
        return await call_local_helper(helper_request)
    try:
        return await asyncio.wait_for(run_helpers(
            protocol_text=request.protocol_text,
            source_hash=hashlib.sha256(request.protocol_text.encode()).hexdigest(),
            model=model, steps=request.steps,
            chemicals=[{"name": c.name, "role": c.role, "quantity": c.quantity} for c in request.chemicals],
            transport=transport, capture_output=False,
        ), timeout=300)
    except ValueError:
        raise HTTPException(422, "local_helper_input_invalid") from None
    except TimeoutError:
        raise HTTPException(504, "local_helper_deadline_exceeded") from None


def helper_score(result, stage, number, name):
    row = result["helpers"][stage]
    if row["status"] == "complete":
        return PrincipleScore.model_validate(row["value"])
    return PrincipleScore(principle_number=number, principle_name=name,
                          score=-1, normalized=-1, confidence=ScoreProvenance.UNAVAILABLE,
                          details={"error": row["error"]}, data_sources=[])
