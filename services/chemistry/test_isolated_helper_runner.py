"""Synthetic-only execution of real legacy helpers; no providers permitted."""
import asyncio
import copy
import hashlib
import importlib.util
import json
import socket

import pytest
import llm_client

MODEL = "google/gemma-4-31b-it"
TEXT = "Add ethanol (5 mL). Monitor by TLC."
CHEMICAL = {"name": "ethanol", "role": "solvent", "quantity": "5 mL"}
STEPS = [{"stepNumber": 1, "description": TEXT, "chemicals": [CHEMICAL], "conditions": {}}]
RESPONSES = {
    "yield": json.dumps({"yield_pct": None, "yield_mass_g": None, "reaction_type": "unknown", "confidence": "unknown"}),
    "smiles": "CCO>>CCO",
    "p8": json.dumps([{"step": 1, "classification": "concession_workup", "reason": "Synthetic classification"}]),
    "p11": json.dumps({"score": 5, "monitoring_present": [{"method": "TLC", "step": 1, "evidence": "Monitor by TLC."}], "monitoring_absent": [], "reasoning": "Synthetic assessment"}),
}

@pytest.fixture(autouse=True)
def forbid_network(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Network or legacy provider attempted")
    for name in ("_call_openrouter", "_call_anthropic", "_call_openai_compatible"):
        monkeypatch.setattr(llm_client, name, forbidden)
    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "synthetic")
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic")
    monkeypatch.setenv("LOCAL_LLM_URL", "https://forbidden.invalid")


def invoke(transport, **changes):
    spec = importlib.util.find_spec("isolated_helper_runner")
    assert spec is not None, "Actual isolated helper runner is missing"
    from isolated_helper_runner import run_helpers
    args = dict(protocol_text=TEXT, source_hash=hashlib.sha256(TEXT.encode()).hexdigest(), model=MODEL,
                steps=copy.deepcopy(STEPS), chemicals=[copy.deepcopy(CHEMICAL)], transport=transport)
    args.update(changes)
    return asyncio.run(run_helpers(**args))


def transport_for(calls, responses=None):
    async def transport(request):
        calls.append(request)
        return {"model": request.model, "attempt_id": hashlib.sha256(str(len(calls)).encode()).hexdigest(),
                "text": (responses or RESPONSES)[request.stage]}
    return transport


def test_actual_four_helpers(capsys):
    calls = []
    result = invoke(transport_for(calls))
    assert set(result["helpers"]) == {"yield", "smiles", "p8", "p11"}
    assert {r.stage for r in calls} == set(RESPONSES)
    assert all(r.source_hash == hashlib.sha256(TEXT.encode()).hexdigest() and r.model == MODEL for r in calls)
    assert all(TEXT in r.prompt for r in calls)
    assert result["helpers"]["yield"]["status"] == "complete"
    assert result["helpers"]["p8"]["value"]["score"] == 10
    assert result["helpers"]["p11"]["value"]["score"] == 5
    assert result["helpers"]["p11"]["value"]["confidence"] == "model-inferred"
    import smiles_extractor
    smiles = result["helpers"]["smiles"]
    assert smiles["status"] == ("complete" if smiles_extractor.RDKIT_AVAILABLE else "unavailable")
    assert result["attempted_callbacks"] == len(calls)
    assert capsys.readouterr().out == ""

def test_isolated_helpers_receive_the_entire_source_including_late_outcomes():
    text = TEXT + ('\nDocumented observation.' * 160) + '\nLate source outcome sentinel.'
    calls = []
    invoke(transport_for(calls), protocol_text=text, source_hash=hashlib.sha256(text.encode()).hexdigest())
    assert {r.stage for r in calls} == set(RESPONSES)
    for request in calls:
        assert text in request.prompt, f'{request.stage} silently truncated the authoritative protocol'


@pytest.mark.parametrize("stage", list(RESPONSES))
def test_transport_failures_are_per_helper_unavailable(stage, capsys):
    calls = []
    good = transport_for(calls)
    async def transport(request):
        if request.stage == stage:
            calls.append(request)
            raise RuntimeError("PRIVATE_SECRET_OUTPUT")
        return await good(request)
    result = invoke(transport)
    failed = result["helpers"][stage]
    assert failed["status"] == "unavailable"
    assert failed["failed_callbacks"] == 1
    assert failed["value"] is None
    assert result["failed_callbacks"] == 1
    assert "PRIVATE_SECRET_OUTPUT" not in json.dumps(result) + str(capsys.readouterr())


@pytest.mark.parametrize("stage,bad", [("yield", "{}"), ("p8", '[{"step":99,"classification":"construction","reason":"x"}]'), ("p11", '{}'), ("p11", '{"score":99,"monitoring_present":[],"monitoring_absent":[],"reasoning":"x"}')])
def test_no_legacy_defaults_can_become_complete(stage, bad):
    result = invoke(transport_for([], {**RESPONSES, stage: bad}))
    assert result["helpers"][stage]["status"] == "unavailable"
    assert result["helpers"][stage]["failed_callbacks"] == 1


@pytest.mark.parametrize("change", [
    {"source_hash": "a" * 64}, {"model": "qwen/pending"},
    {"steps": [{**STEPS[0], "description": "Changed private procedure"}]},
    {"chemicals": [{**CHEMICAL, "name": "methanol"}]},
    {"steps": [{**STEPS[0], "stepNumber": True}]},
    {"steps": [{**STEPS[0], "chemicals": []}]},
])
def test_invalid_identity_or_incoherent_inputs_fail_before_transport(change):
    calls = []
    with pytest.raises(ValueError, match="^isolated_input_invalid$"):
        invoke(transport_for(calls), **change)
    assert calls == []


def test_entire_source_hash_not_truncated_prefix():
    text = TEXT + " " * 4000 + "Full source suffix"
    calls = []
    result = invoke(transport_for(calls), protocol_text=text, source_hash=hashlib.sha256(text.encode()).hexdigest())
    assert result["source_hash"] == hashlib.sha256(text.encode()).hexdigest()
    assert all(c.source_hash == result["source_hash"] for c in calls)


@pytest.mark.parametrize("fault", ["model", "attempt_id", "empty", "extra"])
def test_invalid_callback_envelope_counted_even_before_legacy_parse(fault):
    async def transport(request):
        result = {"model": request.model, "text": RESPONSES[request.stage], "attempt_id": "a" * 64}
        if fault == "model":
            result["model"] = "forbidden/model"
        elif fault == "attempt_id":
            result["attempt_id"] = "invalid"
        elif fault == "empty":
            result["text"] = ""
        else:
            result["private_extra"] = "SECRET"
        return result
    result = invoke(transport)
    assert result["attempted_callbacks"] == result["failed_callbacks"] == 4
    assert all(row["status"] == "unavailable" and row["value"] is None for row in result["helpers"].values())
    assert "SECRET" not in json.dumps(result)


def test_swallowed_exception_cannot_substitute_completed_helper(monkeypatch):
    import scoring.p11_realtime_analysis as p11
    from scoring.models import PrincipleScore, ScoreProvenance
    original = p11.score_p11
    async def swallowing(*args, **kwargs):
        try:
            return await original(*args, **kwargs)
        except Exception:
            return PrincipleScore(principle_number=11, principle_name="fallback", score=2, normalized=0.2,
                                  confidence=ScoreProvenance.MODEL_INFERRED)
    monkeypatch.setattr(p11, "score_p11", swallowing)
    async def transport(request):
        raise RuntimeError("PRIVATE")
    result = invoke(transport)
    assert result["helpers"]["p11"]["failed_callbacks"] == 1
    assert result["helpers"]["p11"]["status"] == "unavailable"
    assert result["helpers"]["p11"]["value"] is None


def test_malformed_smiles_runs_actual_validation_without_success():
    calls = []
    result = invoke(transport_for(calls, {**RESPONSES, "smiles": "not reaction smiles"}))
    assert result["helpers"]["smiles"]["status"] == "unavailable"
    assert result["helpers"]["smiles"]["attempted_callbacks"] == 2
    assert result["helpers"]["smiles"]["value"] is None


def test_cancellation_propagates_without_running_remaining_helpers():
    calls = []
    async def transport(request):
        calls.append(request)
        raise asyncio.CancelledError
    with pytest.raises(asyncio.CancelledError):
        invoke(transport)
    assert len(calls) == 1


def test_reordered_source_steps_fail_before_transport():
    text = "First operation. Second operation."
    steps = [{"stepNumber": i, "description": desc, "chemicals": [], "conditions": {}}
             for i, desc in enumerate(["Second operation.", "First operation."], 1)]
    calls = []
    with pytest.raises(ValueError, match="isolated_input_invalid"):
        invoke(transport_for(calls), protocol_text=text,
               source_hash=hashlib.sha256(text.encode()).hexdigest(), steps=steps, chemicals=[])
    assert calls == []
