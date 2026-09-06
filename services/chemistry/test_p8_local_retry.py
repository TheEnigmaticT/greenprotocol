"""P8 local/isolated path must recover from an empty JSON array once."""
import asyncio
import hashlib

from isolated_helper_runner import run_helpers
from test_isolated_helper_runner import TEXT, CHEMICAL, STEPS, MODEL, RESPONSES


def test_p8_retries_after_empty_array():
    calls = []

    async def transport(request):
        calls.append(request)
        if request.stage != "p8":
            return {
                "model": MODEL,
                "attempt_id": "a" * 64,
                "text": RESPONSES[request.stage],
            }
        # First P8 attempt: empty array (local model failure mode).
        p8_calls = [c for c in calls if c.stage == "p8"]
        if len(p8_calls) == 1:
            return {"model": MODEL, "attempt_id": "b" * 64, "text": "[]"}
        assert "Previous response was invalid" in request.prompt
        assert "Never return []" in request.prompt
        return {"model": MODEL, "attempt_id": "c" * 64, "text": RESPONSES["p8"]}

    result = asyncio.run(run_helpers(
        protocol_text=TEXT,
        source_hash=hashlib.sha256(TEXT.encode()).hexdigest(),
        model=MODEL,
        steps=STEPS,
        chemicals=[CHEMICAL],
        transport=transport,
        capture_output=False,
    ))
    assert result["helpers"]["p8"]["status"] == "complete"
    assert result["helpers"]["p8"]["attempted_callbacks"] == 2
    assert result["helpers"]["p8"]["failed_callbacks"] == 0
    assert sum(1 for c in calls if c.stage == "p8") == 2


def test_p8_prompt_requires_every_step():
    from scoring import p8_reduce_derivatives as p8
    assert "Never return []" in p8.SYSTEM_PROMPT
    assert "exactly once" in p8.SYSTEM_PROMPT.lower() or "every step" in p8.SYSTEM_PROMPT.lower()
