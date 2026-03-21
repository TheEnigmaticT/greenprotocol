"""P5: Design for Safer Solvents and Auxiliaries

Deterministic scoring using CHEM21 solvent guide classifications
weighted by mass. A protocol's P5 score reflects how hazardous
its solvent choices are, scaled by how much of each is used.

Score: 0 (all recommended solvents) to 10 (all highly hazardous)
"""

from scoring.models import ChemicalInput, PrincipleScore
from chem21 import lookup_solvent, SolventEntry

# Weight multipliers for CHEM21 classifications
CLASS_WEIGHTS = {
    "recommended": 0.0,
    "problematic": 0.4,
    "hazardous": 0.7,
    "highly_hazardous": 1.0,
}


def score_p5(chemicals: list[ChemicalInput]) -> PrincipleScore:
    """Score Principle 5: Safer Solvents and Auxiliaries.
    
    Method: For each solvent, look up CHEM21 classification and
    weight by mass fraction. Non-solvents are ignored.
    """
    solvents = [c for c in chemicals if c.role.lower() in
                ("solvent", "washing solvent", "co-solvent", "auxiliary")]

    if not solvents:
        return PrincipleScore(
            principle_number=5,
            principle_name="Safer Solvents and Auxiliaries",
            score=0.0,
            normalized=0.0,
            details={"note": "No solvents identified in protocol"},
            confidence="calculated",
            data_sources=["chem21"],
        )

    total_mass_g = 0.0
    weighted_hazard = 0.0
    flagged: list[str] = []
    solvent_details: list[dict] = []

    for chem in solvents:
        mass_g = chem.quantity_g or 0.0
        if mass_g <= 0:
            mass_g = 100.0  # Default assumption if mass unknown

        entry = lookup_solvent(chem.name)

        if entry:
            weight = CLASS_WEIGHTS.get(entry.classification, 0.5)
            weighted_hazard += mass_g * weight
            total_mass_g += mass_g

            if entry.classification in ("hazardous", "highly_hazardous"):
                flagged.append(chem.name)

            solvent_details.append({
                "name": chem.name,
                "chem21_name": entry.name,
                "classification": entry.classification,
                "safety": entry.safety,
                "health": entry.health,
                "environment": entry.environment,
                "mass_g": round(mass_g, 2),
                "weight": weight,
            })
        else:
            # Unknown solvent — assume problematic
            weighted_hazard += mass_g * 0.5
            total_mass_g += mass_g
            solvent_details.append({
                "name": chem.name,
                "classification": "unknown",
                "mass_g": round(mass_g, 2),
                "weight": 0.5,
            })

    # Normalize: 0 = all recommended, 10 = all highly hazardous
    raw_score = (weighted_hazard / total_mass_g * 10) if total_mass_g > 0 else 0
    score = min(10.0, round(raw_score, 2))

    return PrincipleScore(
        principle_number=5,
        principle_name="Safer Solvents and Auxiliaries",
        score=score,
        normalized=round(score / 10.0, 4),
        details={
            "total_solvent_mass_g": round(total_mass_g, 2),
            "solvents": solvent_details,
        },
        chemicals_flagged=flagged,
        data_sources=["chem21"],
        confidence="calculated",
    )
