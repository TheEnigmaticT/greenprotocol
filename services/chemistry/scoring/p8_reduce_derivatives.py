"""P8: Reduce Derivatives (Baran Ideality Metric)

Quantitative scoring using Baran's published % Ideality formula:

  % Ideality = (construction + strategic_redox) / total_steps × 100

Step classifications:
  - Construction: forms a skeletal bond in the target molecule
  - Strategic redox: essential oxidation/reduction for the route
  - Concession: protecting groups, FGI, non-strategic redox, workup

IMPORTANT CONTEXT:
  - DOZN acknowledges they cannot yet score P8 quantitatively.
    Their documentation states their aspiration is to "develop a
    process to catalog reductions in derivatization waste."
  - Our approach uses Baran's published metric, which is strictly
    structural and does NOT assess whether protecting groups were
    *necessary* — only whether they were *used*.
  - The unsolved problem: determining if a protecting group was
    avoidable requires knowledge of alternative synthetic routes,
    which is a research-level question. Future work could suggest
    protecting-group-free alternatives from literature.

CONFIDENCE: This score should always be flagged as "estimated" in
the UI because the step classification comes from an LLM call,
not from deterministic analysis. The math is deterministic, but
the input classification is not.

Sources:
  - Baran, JACS 2012: "Aiming for the Ideal Synthesis"
    DOI: 10.1021/jo1006812
  - Baran, JACS 2021: "Ideality in Context"
    DOI: 10.1021/jacs.0c13064

Score: 0 (100% ideal, no concessions) to 10 (0% ideal, all concessions)
"""

from scoring.models import PrincipleScore
from llm_client import call_llm
import json
import re


SYSTEM_PROMPT = """You are a synthetic chemistry expert. Classify each
step of a synthesis protocol using Baran's ideality framework.

For each step, assign ONE classification:
- "construction": forms a skeletal C-C, C-N, C-O or other bond that
  appears in the final target molecule
- "strategic_redox": an oxidation or reduction that is essential to
  the synthetic strategy (not just adjusting oxidation state for a
  later step)
- "concession_protection": adding or removing a protecting group
- "concession_fgi": functional group interconversion not building
  the skeleton
- "concession_redox": non-strategic oxidation/reduction (adjusting
  oxidation state for compatibility)
- "concession_workup": purification, extraction, crystallization,
  filtration
- "concession_other": anything else non-productive

Respond with ONLY a JSON array. Each element:
{"step": <number>, "classification": "<type>", "reason": "<brief>"}"""


IDEAL_TYPES = {"construction", "strategic_redox"}
CONCESSION_TYPES = {
    "concession_protection", "concession_fgi",
    "concession_redox", "concession_workup", "concession_other",
}


async def _classify_steps(
    steps: list[dict], protocol_text: str
) -> tuple[list[dict], dict]:
    """Use a surgical LLM call to classify each step."""
    metadata = {"llm_called": False, "error": None}

    step_descriptions = []
    for s in steps:
        desc = s.get("description", "")
        num = s.get("stepNumber", 0)
        chems = ", ".join(c.get("name", "") for c in s.get("chemicals", []))
        step_descriptions.append(f"Step {num}: {desc} [chemicals: {chems}]")

    prompt = (
        f"Classify each step of this synthesis:\n\n"
        f"Protocol:\n{protocol_text[:2000]}\n\n"
        f"Steps:\n" + "\n".join(step_descriptions) + "\n\n"
        f"Respond with ONLY the JSON array."
    )

    metadata["llm_called"] = True
    response = await call_llm(prompt, system=SYSTEM_PROMPT)

    if not response:
        metadata["error"] = "LLM returned no response"
        return [], metadata

    try:
        clean = response.strip()
        if clean.startswith("```"):
            clean = re.sub(r"^```\w*\n?", "", clean)
            clean = re.sub(r"\n?```$", "", clean)
        classifications = json.loads(clean)
        return classifications, metadata
    except json.JSONDecodeError:
        metadata["error"] = f"Failed to parse: {response[:200]}"
        return [], metadata


async def score_p8(
    steps: list[dict],
    protocol_text: str = "",
) -> PrincipleScore:
    """Score Principle 8: Reduce Derivatives (Baran Ideality).
    
    Args:
        steps: parsed steps from Phase 1
        protocol_text: original protocol text for LLM classification
    """
    if not steps:
        return PrincipleScore(
            principle_number=8,
            principle_name="Reduce Derivatives (Baran Ideality)",
            score=-1.0, normalized=-1.0,
            details={"error": "No steps to classify"},
            confidence="unavailable",
            data_sources=[],
        )

    if not protocol_text:
        return PrincipleScore(
            principle_number=8,
            principle_name="Reduce Derivatives (Baran Ideality)",
            score=-1.0, normalized=-1.0,
            details={"error": "Protocol text required for step classification"},
            confidence="unavailable",
            data_sources=[],
        )

    classifications, metadata = await _classify_steps(steps, protocol_text)

    if not classifications:
        return PrincipleScore(
            principle_number=8,
            principle_name="Reduce Derivatives (Baran Ideality)",
            score=-1.0, normalized=-1.0,
            details={"error": metadata.get("error", "Classification failed"),
                     "llm_called": metadata.get("llm_called")},
            confidence="unavailable",
            data_sources=[],
        )

    # Count by category
    construction = 0
    strategic_redox = 0
    concession_protection = 0
    concession_other = 0
    total = len(classifications)

    step_details = []
    for c in classifications:
        cls = c.get("classification", "concession_other")
        if cls == "construction":
            construction += 1
        elif cls == "strategic_redox":
            strategic_redox += 1
        elif cls == "concession_protection":
            concession_protection += 1
        else:
            concession_other += 1

        step_details.append({
            "step": c.get("step"),
            "classification": cls,
            "reason": c.get("reason", ""),
        })

    # Baran ideality percentage
    ideal_steps = construction + strategic_redox
    ideality_pct = (ideal_steps / total * 100) if total > 0 else 0

    # Score: 100% ideality = 0/10, 0% ideality = 10/10
    score = round(10.0 * (1.0 - ideality_pct / 100.0), 2)
    score = max(0.0, min(10.0, score))

    # Flag chemicals used in protection/deprotection
    flagged = []
    for c in classifications:
        if c.get("classification") == "concession_protection":
            step_num = c.get("step", 0)
            for s in steps:
                if s.get("stepNumber") == step_num:
                    for chem in s.get("chemicals", []):
                        name = chem.get("name", "")
                        if name and name not in flagged:
                            flagged.append(name)

    return PrincipleScore(
        principle_number=8,
        principle_name="Reduce Derivatives (Baran Ideality)",
        score=score,
        normalized=round(score / 10.0, 4),
        details={
            "ideality_pct": round(ideality_pct, 1),
            "total_steps": total,
            "construction_steps": construction,
            "strategic_redox_steps": strategic_redox,
            "ideal_steps": ideal_steps,
            "concession_protection_steps": concession_protection,
            "concession_other_steps": concession_other,
            "step_classifications": step_details,
            "methodology": "baran_ideality",
            "methodology_note": (
                "Baran % Ideality = (construction + strategic_redox) / "
                "total_steps × 100. Step classifications from LLM — "
                "the math is deterministic but the input is not. "
                "This metric does NOT assess whether protecting groups "
                "were avoidable (unsolved research problem). "
                "DOZN does not yet score P8 quantitatively."
            ),
        },
        chemicals_flagged=flagged,
        data_sources=["baran_ideality", "llm_classification"],
        # Always "estimated" because step classification is LLM-derived
        confidence="estimated",
    )
