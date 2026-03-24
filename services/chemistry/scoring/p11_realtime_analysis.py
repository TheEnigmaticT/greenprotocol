"""P11: Real-Time Analysis for Pollution Prevention

Assesses whether a protocol includes in-process analytical monitoring,
real-time feedback, or inline quality checks that could prevent waste
by catching problems early rather than at the end.

This is the one principle that is INHERENTLY qualitative — there is no
formula. The score is an LLM assessment of monitoring adequacy.

CONFIDENCE: Always "estimated". The UI MUST surface the full reasoning
so a scientist can evaluate whether the assessment is credible.

What we look for:
  - In-line analytical methods (TLC, HPLC, UV, pH monitoring)
  - Temperature/pressure monitoring during reaction
  - Automated feedback loops (process analytical technology / PAT)
  - Endpoint detection (color change, conductivity, etc.)
  - Sampling and testing during reaction vs only at the end
  - Use of continuous flow with inline analytics

What we DON'T look for (but would improve the score):
  - Post-reaction QC only (this is standard, not real-time)
  - Yield measurement after workup (too late to prevent waste)

Score: 0 (comprehensive real-time monitoring) to 10 (no monitoring at all)
"""

from scoring.models import PrincipleScore
from llm_client import call_llm
import json
import re

SYSTEM_PROMPT = """You are a process analytical chemistry expert assessing
a laboratory protocol for real-time monitoring and analysis capabilities.

Evaluate the protocol against these criteria:
1. In-process analytical methods (TLC, HPLC, UV-Vis, NMR, pH, conductivity)
2. Temperature and pressure monitoring during reactions
3. Automated feedback/control loops (PAT - Process Analytical Technology)
4. Endpoint detection methods (color change, gas evolution cessation, etc.)
5. Sampling frequency — continuous vs periodic vs end-only
6. Continuous flow with inline analytics
7. Opportunities for monitoring that are NOT being used

Be specific and cite evidence from the protocol text. If the protocol
doesn't mention monitoring, say so — don't assume it exists.

Respond with ONLY a JSON object:
{
  "score": <0-10>,
  "monitoring_present": [
    {"method": "<what>", "step": <number>, "evidence": "<quote from protocol>"}
  ],
  "monitoring_absent": [
    {"opportunity": "<what could be monitored>", "step": <number>,
     "rationale": "<why this would help prevent waste>"}
  ],
  "reasoning": "<2-3 sentence explanation of the score>"
}"""


async def score_p11(
    steps: list[dict],
    protocol_text: str = "",
) -> PrincipleScore:
    """Score Principle 11: Real-Time Analysis for Pollution Prevention.

    Args:
        steps: parsed steps from Phase 1
        protocol_text: original protocol text
    """
    if not protocol_text:
        return PrincipleScore(
            principle_number=11,
            principle_name="Real-Time Analysis for Pollution Prevention",
            score=-1.0, normalized=-1.0,
            details={"error": "Protocol text required for monitoring assessment"},
            confidence="unavailable",
            data_sources=[],
        )

    step_descriptions = []
    for s in steps:
        num = s.get("stepNumber", 0)
        desc = s.get("description", "")
        conds = s.get("conditions", {})
        temp = conds.get("temperature", "")
        step_descriptions.append(f"Step {num}: {desc} (temp: {temp})")

    prompt = (
        f"Assess the real-time monitoring capabilities of this protocol.\n\n"
        f"Protocol text:\n{protocol_text[:3000]}\n\n"
        f"Parsed steps:\n" + "\n".join(step_descriptions) + "\n\n"
        f"Respond with ONLY the JSON object."
    )

    response = await call_llm(prompt, system=SYSTEM_PROMPT)
    if not response:
        return PrincipleScore(
            principle_number=11,
            principle_name="Real-Time Analysis for Pollution Prevention",
            score=-1.0, normalized=-1.0,
            details={"error": "LLM returned no response"},
            confidence="unavailable",
            data_sources=[],
        )

    # Parse response
    try:
        clean = response.strip()
        if clean.startswith("```"):
            clean = re.sub(r"^```\w*\n?", "", clean)
            clean = re.sub(r"\n?```$", "", clean)
        data = json.loads(clean)
    except json.JSONDecodeError:
        return PrincipleScore(
            principle_number=11,
            principle_name="Real-Time Analysis for Pollution Prevention",
            score=-1.0, normalized=-1.0,
            details={"error": f"Failed to parse assessment: {response[:300]}"},
            confidence="unavailable",
            data_sources=[],
        )

    llm_score = data.get("score", 8)
    score = max(0.0, min(10.0, float(llm_score)))
    monitoring_present = data.get("monitoring_present", [])
    monitoring_absent = data.get("monitoring_absent", [])
    reasoning = data.get("reasoning", "")

    return PrincipleScore(
        principle_number=11,
        principle_name="Real-Time Analysis for Pollution Prevention",
        score=round(score, 2),
        normalized=round(score / 10.0, 4),
        details={
            "reasoning": reasoning,
            "monitoring_present": monitoring_present,
            "monitoring_absent": monitoring_absent,
            "monitoring_count": len(monitoring_present),
            "opportunity_count": len(monitoring_absent),
            "methodology_note": (
                "This score is an AI assessment, not a deterministic "
                "calculation. The reasoning is provided so you can "
                "evaluate whether the assessment is accurate for your "
                "specific laboratory setup. Monitoring equipment and "
                "practices not mentioned in the protocol text cannot "
                "be accounted for."
            ),
        },
        chemicals_flagged=[],
        data_sources=["llm_assessment"],
        confidence="estimated",
    )
