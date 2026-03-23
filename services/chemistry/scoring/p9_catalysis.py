"""P9: Use of Catalysts

Deterministic scoring based on the ratio of catalytic vs
stoichiometric reagents by mass. Protocols using catalysts
efficiently score well; those using large stoichiometric
excesses of reagents score poorly.

Score: 0 (all catalytic) to 10 (all stoichiometric, no catalysts)
"""

from scoring.models import ChemicalInput, PrincipleScore

# Roles considered catalytic
CATALYTIC_ROLES = {
    "catalyst", "co-catalyst", "cocatalyst", "photocatalyst",
    "enzyme", "biocatalyst", "organocatalyst", "ligand",
    "phase-transfer catalyst", "ptc",
}

# Roles considered stoichiometric reagents
STOICHIOMETRIC_ROLES = {
    "reagent", "reactant", "coupling reagent", "oxidant",
    "reductant", "reducing agent", "oxidizing agent",
    "base", "acid", "activating agent", "deprotecting agent",
}

# Roles to skip (not scored)
EXCLUDED_ROLES = {
    "solvent", "washing solvent", "co-solvent", "auxiliary",
    "product", "byproduct", "starting material", "substrate",
}


def _classify_role(role: str) -> str:
    """Classify a chemical role as catalytic, stoichiometric, or other."""
    r = role.lower().strip()
    if r in CATALYTIC_ROLES or "catalyst" in r:
        return "catalytic"
    if r in STOICHIOMETRIC_ROLES:
        return "stoichiometric"
    if r in EXCLUDED_ROLES:
        return "excluded"
    # Default: assume stoichiometric if it's doing chemistry
    return "stoichiometric"


def score_p9(chemicals: list[ChemicalInput]) -> PrincipleScore:
    """Score Principle 9: Use of Catalysts.
    
    Method: Calculate ratio of stoichiometric reagent mass to
    total reagent mass (excluding solvents/products). Protocols
    with no catalysts at all get penalized extra.
    """
    catalytic_mass = 0.0
    stoichiometric_mass = 0.0
    flagged: list[str] = []
    chem_details: list[dict] = []

    for chem in chemicals:
        classification = _classify_role(chem.role)
        if classification == "excluded":
            continue

        mass_g = chem.quantity_g or 10.0

        if classification == "catalytic":
            catalytic_mass += mass_g
        else:
            stoichiometric_mass += mass_g
            if mass_g > 5.0:  # Flag large stoichiometric reagents
                flagged.append(chem.name)

        chem_details.append({
            "name": chem.name,
            "role": chem.role,
            "classification": classification,
            "mass_g": round(mass_g, 2),
        })

    total_reagent_mass = catalytic_mass + stoichiometric_mass

    if total_reagent_mass == 0:
        return PrincipleScore(
            principle_number=9,
            principle_name="Use of Catalysts",
            score=0.0, normalized=0.0,
            details={"note": "No reagents identified"},
            confidence="partial",
            data_sources=["protocol_parse"],
        )

    # Score based on stoichiometric fraction
    stoich_fraction = stoichiometric_mass / total_reagent_mass

    # Extra penalty if zero catalysts used at all
    no_catalyst_penalty = 2.0 if catalytic_mass == 0 else 0.0

    raw_score = (stoich_fraction * 8.0) + no_catalyst_penalty
    score = min(10.0, round(raw_score, 2))

    return PrincipleScore(
        principle_number=9,
        principle_name="Use of Catalysts",
        score=score,
        normalized=round(score / 10.0, 4),
        details={
            "catalytic_mass_g": round(catalytic_mass, 2),
            "stoichiometric_mass_g": round(stoichiometric_mass, 2),
            "stoichiometric_fraction": round(stoich_fraction, 4),
            "has_catalysts": catalytic_mass > 0,
            "chemicals": chem_details,
        },
        chemicals_flagged=flagged,
        data_sources=["protocol_parse"],
        confidence="calculated",
    )
