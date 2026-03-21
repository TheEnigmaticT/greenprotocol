"""P12: Inherently Safer Chemistry for Accident Prevention

Deterministic scoring using GHS physical hazard codes
weighted by quantity. Flammable, explosive, and reactive
chemicals score worst.

Score: 0 (no physical hazards) to 10 (explosive/highly flammable)
"""

from scoring.models import ChemicalInput, PrincipleScore
from ghs import score_physical_hazard


def score_p12(
    chemicals: list[ChemicalInput],
    hcodes_map: dict[str, list[str]],
) -> PrincipleScore:
    """Score Principle 12: Accident Prevention."""
    if not chemicals:
        return PrincipleScore(
            principle_number=12,
            principle_name="Inherently Safer Chemistry for Accident Prevention",
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
        phys_score = score_physical_hazard(codes)
        mass_g = chem.quantity_g or 10.0

        weighted_hazard += mass_g * (phys_score / 10.0)
        total_mass_g += mass_g

        if phys_score >= 6:
            flagged.append(chem.name)

        chem_details.append({
            "name": chem.name,
            "physical_score": phys_score,
            "physical_hcodes": [c for c in codes if c.startswith("H2")],
            "mass_g": round(mass_g, 2),
        })

    raw_score = (weighted_hazard / total_mass_g * 10) if total_mass_g > 0 else 0
    score = min(10.0, round(raw_score, 2))

    return PrincipleScore(
        principle_number=12,
        principle_name="Inherently Safer Chemistry for Accident Prevention",
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
