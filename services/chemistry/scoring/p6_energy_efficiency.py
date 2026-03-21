"""P6: Design for Energy Efficiency

Deterministic scoring based on temperature deviation from ambient.
Reactions at ambient temperature score best; extreme temps score worst.

Score: 0 (all at ambient) to 10 (extreme temperatures)
"""

from scoring.models import ChemicalInput, PrincipleScore

AMBIENT_TEMP_C = 20.0


def score_p6(
    steps: list[dict],
) -> PrincipleScore:
    """Score Principle 6: Design for Energy Efficiency.
    
    Args:
        steps: list of step dicts with 'conditions.temperature' strings
               e.g. [{"stepNumber": 1, "conditions": {"temperature": "75-80°C"}}]
    """
    temps: list[dict] = []
    max_deviation = 0.0

    for step in steps:
        conds = step.get("conditions", {})
        temp_str = conds.get("temperature")
        if not temp_str or temp_str == "null":
            continue

        parsed = _parse_temp(temp_str)
        if parsed is not None:
            deviation = abs(parsed - AMBIENT_TEMP_C)
            max_deviation = max(max_deviation, deviation)
            temps.append({
                "step": step.get("stepNumber", 0),
                "raw": temp_str,
                "parsed_c": parsed,
                "deviation": round(deviation, 1),
            })

    if not temps:
        return PrincipleScore(
            principle_number=6,
            principle_name="Design for Energy Efficiency",
            score=0.0, normalized=0.0,
            details={"note": "No temperature data found"},
            confidence="partial",
            data_sources=["protocol_parse"],
        )

    # Score: deviation of 0=0, 50=5, 100+=10
    avg_deviation = sum(t["deviation"] for t in temps) / len(temps)
    score = min(10.0, round(avg_deviation / 10.0, 2))

    return PrincipleScore(
        principle_number=6,
        principle_name="Design for Energy Efficiency",
        score=score,
        normalized=round(score / 10.0, 4),
        details={
            "temperatures": temps,
            "avg_deviation_c": round(avg_deviation, 1),
            "max_deviation_c": round(max_deviation, 1),
        },
        data_sources=["protocol_parse"],
        confidence="calculated",
    )


def _parse_temp(s: str) -> float | None:
    """Parse temperature from strings like '75-80°C', 'rt', '-78°C'."""
    import re
    s = s.lower().strip()

    if s in ("rt", "room temperature", "ambient", "room temp"):
        return AMBIENT_TEMP_C

    # Range: "75-80°C" -> take midpoint
    m = re.search(r"(-?\d+\.?\d*)\s*[-–to]+\s*(-?\d+\.?\d*)\s*°?\s*c", s)
    if m:
        return (float(m.group(1)) + float(m.group(2))) / 2

    # Single value: "75°C", "75 C", "75 degrees"
    m = re.search(r"(-?\d+\.?\d*)\s*°?\s*c", s)
    if m:
        return float(m.group(1))

    # Just a number (assume Celsius)
    m = re.search(r"(-?\d+\.?\d*)", s)
    if m:
        return float(m.group(1))

    return None
