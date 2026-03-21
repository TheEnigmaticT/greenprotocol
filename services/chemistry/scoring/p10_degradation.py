"""P10: Design for Degradation

Deterministic scoring using GHS environmental hazard codes
weighted by quantity. Chemicals with aquatic toxicity and
persistence score worst.

Score: 0 (all biodegradable) to 10 (persistent environmental hazards)
"""

from scoring.models import ChemicalInput, PrincipleScore
from ghs import score_environmental_hazard


def score_p10(
    chemicals: list[ChemicalInput],
    hcodes_map: dict[str, list[str]],
) -> PrincipleScore:
    """Score Principle 10: Design for Degradation."""
    if not chemicals:
        return PrincipleScore(
            principle_number=10,
            principle_name="Design for Degradation",
            score=0.0, normalized=0.0,
            details={"note": "No chemicals to evaluate"},
            confidence="calculated",
            data_sources=["pubchem_ghs"],
        )

    total_mass_g = 0.0
    weighted_hazard = 0.0
    flagged: list[str] = []
    chem_details: list[dict] = []

    for chem in chemicals:
        codes = hcodes_map.get(chem.name, [])
        env_score = score_environmental_hazard(codes)
        mass_g = chem.quantity_g or 10.0

        weighted_hazard += mass_g * (env_score / 10.0)
        total_mass_g += mass_g

        if env_score >= 5:
            flagged.append(chem.name)

        chem_details.append({
            "name": chem.name,
            "env_score": env_score,
            "env_hcodes": [c for c in codes if c.startswith("H4")],
            "mass_g": round(mass_g, 2),
        })

    raw_score = (weighted_hazard / total_mass_g * 10) if total_mass_g > 0 else 0
    score = min(10.0, round(raw_score, 2))

    return PrincipleScore(
        principle_number=10,
        principle_name="Design for Degradation",
        score=score,
        normalized=round(score / 10.0, 4),
        details={
            "total_mass_g": round(total_mass_g, 2),
            "chemicals": chem_details,
        },
        chemicals_flagged=flagged,
        data_sources=["pubchem_ghs"],
        confidence="calculated",
    )
