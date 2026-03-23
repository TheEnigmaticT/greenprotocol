"""P7: Use of Renewable Feedstocks

Deterministic scoring based on the fraction of renewable
(bio-based) chemicals by mass. Chemicals derived from
petroleum score poorly; bio-derived chemicals score well.

Score: 0 (all renewable) to 10 (all petroleum-derived)
"""

from scoring.models import ChemicalInput, PrincipleScore

# Curated set of known renewable / bio-based chemicals
# Sources: EPA Safer Chemical Ingredients List, various bio-based reviews
RENEWABLE_CHEMICALS: set[str] = {
    # Bio-based solvents
    "water", "h2o",
    "ethanol", "etoh", "bioethanol",
    "methanol", "meoh",  # can be bio-based (wood methanol)
    "isopropanol", "ipa", "2-propanol",
    "1-butanol", "buoh", "n-butanol",
    "acetic acid", "acoh", "vinegar",
    "lactic acid",
    "glycerol",
    "ethyl lactate",
    "dihydrolevoglucosenone", "cyrene",
    "2-methyltetrahydrofuran", "2-methf",  # from furfural (biomass)
    "limonene", "d-limonene",
    "p-cymene",  # from limonene
    "gamma-valerolactone", "gvl",
    "ethyl acetate", "etoac",  # can be bio-derived
    "isopropyl acetate",
    "dimethyl carbonate",
    "propylene carbonate",
}

# Bio-based reagents and materials
RENEWABLE_CHEMICALS.update({
    "cellulose", "starch", "chitosan", "chitin",
    "sucrose", "glucose", "fructose", "xylose",
    "amino acid", "peptide", "protein",
    "fatty acid", "oleic acid", "palmitic acid",
    "soybean oil", "palm oil", "coconut oil",
    "castor oil", "linseed oil",
    "terpene", "pinene", "camphor",
    "citric acid", "tartaric acid", "malic acid",
    "furan", "furfural", "hmf", "5-hydroxymethylfurfural",
    "levulinic acid", "itaconic acid", "succinic acid",
    "sorbitol", "mannitol", "xylitol",
    "polylactic acid", "pla",
})


def is_renewable(name: str) -> bool:
    """Check if a chemical is in the renewable feedstocks table."""
    return name.lower().strip() in RENEWABLE_CHEMICALS


def score_p7(chemicals: list[ChemicalInput]) -> PrincipleScore:
    """Score Principle 7: Use of Renewable Feedstocks.
    
    Method: Calculate renewable mass fraction. Solvents and reagents
    both count. Products are excluded.
    """
    excluded_roles = {"product", "desired product", "byproduct",
                      "target", "final product"}

    scoreable = [c for c in chemicals
                 if c.role.lower().strip() not in excluded_roles]

    if not scoreable:
        return PrincipleScore(
            principle_number=7,
            principle_name="Use of Renewable Feedstocks",
            score=5.0, normalized=0.5,
            details={"note": "No input chemicals identified"},
            confidence="partial",
            data_sources=["renewable_db"],
        )

    renewable_mass = 0.0
    total_mass = 0.0
    flagged: list[str] = []
    chem_details: list[dict] = []

    for chem in scoreable:
        mass_g = chem.quantity_g or 10.0
        renewable = is_renewable(chem.name)

        total_mass += mass_g
        if renewable:
            renewable_mass += mass_g
        else:
            flagged.append(chem.name)

        chem_details.append({
            "name": chem.name,
            "role": chem.role,
            "is_renewable": renewable,
            "mass_g": round(mass_g, 2),
        })

    petroleum_fraction = 1.0 - (renewable_mass / total_mass) if total_mass > 0 else 1.0
    score = min(10.0, round(petroleum_fraction * 10.0, 2))

    return PrincipleScore(
        principle_number=7,
        principle_name="Use of Renewable Feedstocks",
        score=score,
        normalized=round(score / 10.0, 4),
        details={
            "renewable_mass_g": round(renewable_mass, 2),
            "total_mass_g": round(total_mass, 2),
            "renewable_fraction": round(1.0 - petroleum_fraction, 4),
            "chemicals": chem_details,
        },
        chemicals_flagged=flagged,
        data_sources=["renewable_db"],
        confidence="calculated",
    )
