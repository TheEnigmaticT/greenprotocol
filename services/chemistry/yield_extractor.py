"""Surgical LLM calls for evidence-grounded yield extraction."""
import json
import math
import re
from llm_client import call_llm
from isolated_llm_policy import helper_protocol_context
from reaction_types import get_all_reaction_types, lookup_benchmark

YIELD_SYSTEM = '''Extract only directly stated yield values. Return JSON with yield_pct, yield_mass_g, reaction_type, confidence. Do not infer or convert values.'''


def _number(value, *, minimum: float, maximum: float | None = None) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    value = float(value)
    return value if value > minimum and (maximum is None or value <= maximum) else None


def _evidence(protocol: str, pct: float | None, mass: float | None) -> dict[str, str]:
    found: dict[str, str] = {}
    if pct is not None:
        value = re.escape(f"{pct:g}")
        match = re.search(rf"(?<![\d.])({value}\s*%\s*(?:yield|yielded)?)(?![\d.])", protocol, re.I)
        if match:
            found["yield_pct"] = match.group(1)
    if mass is not None:
        value = re.escape(f"{mass:g}")
        match = re.search(rf"(?<![\d.])({value}\s*(?:g|grams?))(?![a-z])", protocol, re.I)
        if match:
            found["yield_mass_g"] = match.group(1)
    return found


async def extract_yield_and_type(protocol_text: str, chemicals: list[dict] | None = None) -> dict:
    known_types = get_all_reaction_types()
    chem_context = "\n".join(f"- {c.get('name','?')} ({c.get('role','?')}) {c.get('quantity','')}" for c in (chemicals or []))
    prompt = f"Extract yield and classify reaction.\nProtocol:\n{helper_protocol_context(protocol_text, 3000)}\nChemicals:\n{chem_context}\nKnown: {', '.join(known_types)}"
    response = await call_llm(prompt, system=YIELD_SYSTEM, stage="yield")
    if not response:
        return {"error": "LLM returned no response", "llm_called": True}
    try:
        clean = re.sub(r"^```\w*\n?|\n?```$", "", response.strip())
        data = json.loads(clean)
    except json.JSONDecodeError:
        return {"error": f"Failed to parse LLM response: {response[:200]}", "llm_called": True}
    pct = _number(data.get("yield_pct"), minimum=0, maximum=100)
    mass = _number(data.get("yield_mass_g"), minimum=0)
    stated = data.get("confidence") == "stated"
    evidence = _evidence(protocol_text, pct, mass) if stated else {}
    invalid = (data.get("yield_pct") is not None and pct is None) or (data.get("yield_mass_g") is not None and mass is None)
    unsupported = stated and ((pct is not None and "yield_pct" not in evidence) or (mass is not None and "yield_mass_g" not in evidence))
    if not stated:
        pct = mass = None; status = "not_explicitly_stated"; confidence = "unknown"; evidence = {}
    elif invalid:
        pct = mass = None; status = "invalid_stated_value"; confidence = "unknown"; evidence = {}
    elif unsupported:
        pct = mass = None; status = "unsupported_by_protocol"; confidence = "unknown"; evidence = {}
    else:
        status = "explicitly_stated"; confidence = "stated"
    result = {"yield_pct": pct, "yield_mass_g": mass, "reaction_type": data.get("reaction_type", "unknown"), "confidence": confidence,
              "yield_evidence_status": status, "yield_evidence": evidence, "llm_called": True}
    benchmark = lookup_benchmark(result["reaction_type"])
    if benchmark:
        result["benchmark"] = {"reaction_type": benchmark.reaction_type, "typical_efficiency": benchmark.typical_efficiency,
            "efficiency_range": list(benchmark.efficiency_range), "typical_pmi": benchmark.typical_pmi, "pmi_range": list(benchmark.pmi_range)}
    return result
