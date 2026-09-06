"""Private, injected-transport execution of the four actual legacy helpers.

This adapter has no provider, credentials, ledger, or deterministic rescorer.
The parent transport owns every reservation and paid attempt. Returned values
contain private source-derived material: do not print or put them in shared logs.
"""
from collections import Counter
from contextlib import redirect_stderr, redirect_stdout, nullcontext
from copy import deepcopy
import hashlib
import io
import json
import math
import re
from typing import Awaitable, Callable

from isolated_llm_policy import APPROVED_MODELS, HelperRequest, isolated_llm_policy

_HASH = re.compile(r"[0-9a-f]{64}\Z")
_STAGES = ("yield", "smiles", "p8", "p11")


def _text(value):
    return isinstance(value, str) and bool(value.strip())


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


def _validate_input(protocol_text, source_hash, model, steps, chemicals, transport):
    # Strict lossless subset of legacy input: no computed quantities, renamed
    # scenario chemicals, or arbitrary provenance fields pass this boundary.
    try:
        if (not _text(protocol_text) or len(protocol_text.encode("utf-8")) > 1048576
                or not isinstance(source_hash, str) or not _HASH.fullmatch(source_hash)
                or hashlib.sha256(protocol_text.encode("utf-8")).hexdigest() != source_hash
                or model not in APPROVED_MODELS or not callable(transport)
                or not isinstance(steps, list) or not steps or len(steps) > 1000
                or not isinstance(chemicals, list)):
            raise ValueError
        def chemical(c, source):
            if (not isinstance(c, dict) or set(c) != {"name", "role", "quantity"}
                    or not _text(c["name"]) or c["name"] not in source
                    or c["role"] not in {"solvent", "reagent", "reactant", "catalyst", "product", "byproduct", "unknown"}
                    or not isinstance(c["quantity"], str)
                    or (c["quantity"] and c["quantity"] not in source)):
                raise ValueError
            return (c["name"], c["role"], c["quantity"])
        flat = Counter(chemical(c, protocol_text) for c in chemicals)
        nested = Counter()
        source_cursor = 0
        for index, step in enumerate(steps, 1):
            if (not isinstance(step, dict) or set(step) != {"stepNumber", "description", "chemicals", "conditions"}
                    or type(step["stepNumber"]) is not int or step["stepNumber"] != index
                    or not _text(step["description"]) or step["description"] not in protocol_text
                    or not isinstance(step["chemicals"], list)
                    or not isinstance(step["conditions"], dict)):
                raise ValueError
            start = protocol_text.find(step["description"], source_cursor)
            if start < 0:
                raise ValueError
            source_cursor = start + len(step["description"])
            nested.update(chemical(c, step["description"]) for c in step["chemicals"])
            if any(k not in {"temperature", "duration", "pressure", "atmosphere"}
                   or not _text(v) or v not in step["description"]
                   for k, v in step["conditions"].items()):
                raise ValueError
        if flat != nested:
            raise ValueError
    except Exception:
        raise ValueError("isolated_input_invalid") from None


def _validate_response(result, request, steps, source):
    if (not isinstance(result, dict) or set(result) != {"model", "text", "attempt_id"}
            or result["model"] != request.model or not isinstance(result["attempt_id"], str)
            or not _HASH.fullmatch(result["attempt_id"]) or not _text(result["text"])
            or len(result["text"].encode("utf-8")) > 131072):
        raise ValueError
    if request.stage == "smiles":
        # Actual legacy RDKit validation is authoritative; do not simulate it.
        return
    clean = result["text"].strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```\w*\n?", "", clean)
        clean = re.sub(r"\n?```$", "", clean)
    data = json.loads(clean)
    ids = {s["stepNumber"] for s in steps}
    if request.stage == "yield":
        if (not isinstance(data, dict) or set(data) != {"yield_pct", "yield_mass_g", "reaction_type", "confidence"}
                or not _text(data["reaction_type"]) or data["confidence"] not in {"stated", "inferred", "unknown"}
                or (data["yield_pct"] is not None and (not _number(data["yield_pct"]) or not 0 <= data["yield_pct"] <= 100))
                or (data["yield_mass_g"] is not None and (not _number(data["yield_mass_g"]) or data["yield_mass_g"] < 0))):
            raise ValueError
    elif request.stage == "p8":
        from scoring.p8_reduce_derivatives import IDEAL_TYPES, CONCESSION_TYPES
        if (not isinstance(data, list) or len(data) != len(ids)
                or any(not isinstance(c, dict) or set(c) != {"step", "classification", "reason"}
                       or type(c["step"]) is not int or c["step"] not in ids
                       or c["classification"] not in IDEAL_TYPES | CONCESSION_TYPES or not _text(c["reason"])
                       for c in data)
                or {c["step"] for c in data} != ids):
            raise ValueError
    elif request.stage == "p11":
        if (not isinstance(data, dict) or set(data) != {"score", "monitoring_present", "monitoring_absent", "reasoning"}
                or not _number(data["score"]) or not 0 <= data["score"] <= 10 or not _text(data["reasoning"])):
            raise ValueError
        for key, fields in (("monitoring_present", {"method", "step", "evidence"}),
                            ("monitoring_absent", {"opportunity", "step", "rationale"})):
            rows = data[key]
            if not isinstance(rows, list):
                raise ValueError
            for row in rows:
                if (not isinstance(row, dict) or set(row) != fields
                        or type(row["step"]) is not int or row["step"] not in ids
                        or any(not _text(row[k]) for k in fields - {"step"})):
                    raise ValueError
                if key == "monitoring_present" and row["evidence"] not in source:
                    raise ValueError


async def run_helpers(*, protocol_text: str, source_hash: str, model: str,
                      steps: list[dict], chemicals: list[dict],
                      transport: Callable[[HelperRequest], Awaitable[dict]],
                      capture_output: bool = True) -> dict:
    """Return private results, with independent per-helper callback counters.

    Default output capture is for dedicated workers only (process-global).
    Shared service callers must pass capture_output=False. Cancellation propagates.
    Input rejection raises only ``isolated_input_invalid`` before any callback.
    """
    _validate_input(protocol_text, source_hash, model, steps, chemicals, transport)
    # Freeze the validated input against caller mutation across await points.
    steps, chemicals = deepcopy(steps), deepcopy(chemicals)
    helpers = {}
    for stage in _STAGES:
        row = {"status": "unavailable", "attempted_callbacks": 0, "failed_callbacks": 0,
               "error": None, "value": None}

        async def tracked(request):
            row["attempted_callbacks"] += 1
            try:
                if request.stage != stage or request.model != model or request.source_hash != source_hash:
                    raise ValueError
                result = await transport(request)
                try:
                    _validate_response(result, request, steps, protocol_text)
                    return result
                except ValueError:
                    # One repair for P8 only when the envelope is otherwise OK but the
                    # JSON schema failed (local models often return []). Keep
                    # failed_callbacks at 0 so a recovered call can still complete.
                    if request.stage != "p8" or not isinstance(result, dict):
                        raise
                    if (set(result) != {"model", "text", "attempt_id"}
                            or result.get("model") != request.model
                            or not isinstance(result.get("attempt_id"), str)
                            or not _HASH.fullmatch(result["attempt_id"])
                            or not _text(result.get("text"))):
                        raise
                    ids = sorted({s["stepNumber"] for s in steps})
                    repair_prompt = (
                        request.prompt
                        + f"\n\nPrevious response was invalid. Return a JSON array with exactly "
                        + f"{len(ids)} object(s) for step numbers {ids}. Never return []. "
                        + 'Example: [{"step": 1, "classification": "concession_workup", "reason": "brief"}]'
                    )
                    repair_request = type(request)(
                        stage=request.stage,
                        model=request.model,
                        source_hash=request.source_hash,
                        prompt=repair_prompt,
                        system=request.system,
                    )
                    row["attempted_callbacks"] += 1
                    result = await transport(repair_request)
                    _validate_response(result, request, steps, protocol_text)
                    return result
            except BaseException:
                row["failed_callbacks"] += 1
                raise

        try:
            # Suppress legacy diagnostics, including source-bearing parse errors.
            with (redirect_stdout(io.StringIO()) if capture_output else nullcontext()), (redirect_stderr(io.StringIO()) if capture_output else nullcontext()):
                with isolated_llm_policy(model=model, source_hash=source_hash, transport=tracked):
                    if stage == "yield":
                        from yield_extractor import extract_yield_and_type
                        value = await extract_yield_and_type(protocol_text, chemicals)
                        valid = isinstance(value, dict) and not value.get("error") and value.get("llm_called") is True
                    elif stage == "smiles":
                        from smiles_extractor import extract_reaction_smiles
                        smiles, metadata = await extract_reaction_smiles(protocol_text, chemicals)
                        value = {"reaction_smiles": smiles, "metadata": metadata}
                        valid = bool(smiles) and metadata.get("validated") is True
                    else:
                        if stage == "p8":
                            from scoring.p8_reduce_derivatives import score_p8
                            score = await score_p8(steps, protocol_text)
                        else:
                            from scoring.p11_realtime_analysis import score_p11
                            score = await score_p11(steps, protocol_text)
                        value = score.model_dump(mode="json")
                        valid = value["confidence"] != "unavailable" and 0 <= value["score"] <= 10
                        # Preserve explicit model provenance at the frozen boundary,
                        # including when used with older PrincipleScore validators.
                        value["legacy_confidence"] = value["confidence"]
                        value["confidence"] = "model-inferred"
            if valid and row["attempted_callbacks"] > 0 and row["failed_callbacks"] == 0:
                row.update(status="complete", value=value)
            else:
                row["error"] = "helper_unavailable"
        except Exception:
            row["error"] = "helper_failed"
        helpers[stage] = row
    return {"source_hash": source_hash, "model": model, "helpers": helpers,
            "attempted_callbacks": sum(r["attempted_callbacks"] for r in helpers.values()),
            "failed_callbacks": sum(r["failed_callbacks"] for r in helpers.values())}
