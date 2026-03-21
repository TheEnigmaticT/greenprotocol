"""P3: Less Hazardous Chemical Syntheses

Deterministic scoring using GHS health hazard codes weighted by
quantity. A protocol's P3 score reflects the aggregate health
hazard of all chemicals used.

Score: 0 (no health hazards) to 10 (severe CMR chemicals in large qty)
"""

from scoring.models import ChemicalInput, PrincipleScore
from ghs import score_health_hazard, is_cmr


def score_p3(
    chemicals: list[ChemicalInput],
    hcodes_map: dict[str, list[str]],
) -> PrincipleScore:
    """Score Principle 3: Less Hazardous Chemical Syntheses.
    
    Args:
        chemicals: parsed chemicals from protocol
        hcodes_map: {chemical_name: [H-codes]} from PubChem
    """
    if not chemicals:
        return PrincipleScore(
            principle_number=3,
            principle_name="Less Hazardous Chemical Syntheses",
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
        health_score = score_health_hazard(codes)
        cmr = is_cmr(codes)

        mass_g = chem.quantity_g or 0.0
        if mass_g <= 0:
            mass_g = 10.0  # Default for unknown quantity

        # CMR chemicals get extra weight
        weight = health_score / 10.0
        if cmr:
            weight = min(1.0, weight * 1.5)

        weighted_hazard += mass_g * weight
        total_mass_g += mass_g

        if health_score >= 7 or cmr:
            flagged.append(chem.name)

        chem_details.append({
            "name": chem.name,
            "role": chem.role,
            "health_score": health_score,
            "is_cmr": cmr,
            "hcodes": codes,
            "mass_g": round(mass_g, 2),
        })

    raw_score = (weighted_hazard / total_mass_g * 10) if total_mass_g > 0 else 0
    score = min(10.0, round(raw_score, 2))

    return PrincipleScore(
        principle_number=3,
        principle_name="Less Hazardous Chemical Syntheses",
        score=score,
        normalized=round(score / 10.0, 4),
        details={
            "total_mass_g": round(total_mass_g, 2),
            "chemicals": chem_details,
            "cmr_chemicals_count": sum(1 for d in chem_details if d["is_cmr"]),
        },
        chemicals_flagged=flagged,
        data_sources=["pubchem_ghs"],
        confidence="calculated",
    )
