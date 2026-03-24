"""Surgical LLM calls for yield extraction and reaction type classification."""

import re
import json
from llm_client import call_llm
from reaction_types import get_all_reaction_types, lookup_benchmark

YIELD_SYSTEM = """You are a chemistry expert. Extract yield information from 
a protocol. Respond with ONLY a JSON object, nothing else.

Format: {"yield_pct": <number or null>, "yield_mass_g": <number or null>, 
"reaction_type": "<type>", "confidence": "stated|inferred|unknown"}

- yield_pct: percentage yield if stated (e.g., 85 for "85% yield")
- yield_mass_g: product mass in grams if stated
- reaction_type: classify the main reaction
- confidence: "stated" if yield is explicitly given in the protocol,
  "inferred" if you calculated it, "unknown" if not determinable"""


async def extract_yield_and_type(
    protocol_text: str,
    chemicals: list[dict] | None = None,
) -> dict:
    """Extract yield and reaction type from protocol text.
    
    Returns dict with: yield_pct, yield_mass_g, reaction_type, 
    confidence, benchmark (if reaction type matched)
    """
    known_types = get_all_reaction_types()
    type_list = ", ".join(known_types)

    chem_context = ""
    if chemicals:
        lines = [f"  - {c.get('name','?')} ({c.get('role','?')}) {c.get('quantity','')}"
                 for c in chemicals]
        chem_context = "\nChemicals:\n" + "\n".join(lines)

    prompt = (
        f"Extract yield and classify the reaction type.\n\n"
        f"Protocol:\n{protocol_text[:3000]}\n"
        f"{chem_context}\n\n"
        f"Known reaction types: {type_list}\n\n"
        f"If the reaction type doesn't match any known type exactly, "
        f"use the closest match or describe it briefly.\n\n"
        f"Respond with ONLY the JSON object."
    )

    response = await call_llm(prompt, system=YIELD_SYSTEM)
    if not response:
        return {"error": "LLM returned no response", "llm_called": True}

    # Parse JSON from response
    try:
        # Handle markdown code fences
        clean = response.strip()
        if clean.startswith("```"):
            clean = re.sub(r"^```\w*\n?", "", clean)
            clean = re.sub(r"\n?```$", "", clean)
        data = json.loads(clean)
    except json.JSONDecodeError:
        return {"error": f"Failed to parse LLM response: {response[:200]}",
                "llm_called": True}

    result = {
        "yield_pct": data.get("yield_pct"),
        "yield_mass_g": data.get("yield_mass_g"),
        "reaction_type": data.get("reaction_type", "unknown"),
        "confidence": data.get("confidence", "unknown"),
        "llm_called": True,
    }

    # Look up benchmark for the reaction type
    rxn_type = result["reaction_type"]
    benchmark = lookup_benchmark(rxn_type)

    # Try fuzzy match if exact match fails
    if not benchmark and rxn_type:
        rxn_lower = rxn_type.lower()
        for key, bm in __import__("reaction_types").REACTION_BENCHMARKS.items():
            if key in rxn_lower or rxn_lower in key:
                benchmark = bm
                break
            if any(w in rxn_lower for w in bm.reaction_type.lower().split()):
                benchmark = bm
                break

    if benchmark:
        result["benchmark"] = {
            "reaction_type": benchmark.reaction_type,
            "typical_efficiency": benchmark.typical_efficiency,
            "efficiency_range": list(benchmark.efficiency_range),
            "typical_pmi": benchmark.typical_pmi,
            "pmi_range": list(benchmark.pmi_range),
        }

    return result
