"""P7: Use of Renewable Feedstocks, weighted by declared mass."""

from scoring.models import ChemicalInput, PrincipleScore
from scoring.input_honesty import MASS_PROVENANCE, missing_mass_inputs, unavailable_score

RENEWABLE_CHEMICALS: set[str] = {"water", "h2o", "ethanol", "etoh", "bioethanol", "methanol", "meoh", "isopropanol", "ipa", "2-propanol", "1-butanol", "buoh", "n-butanol", "acetic acid", "acoh", "vinegar", "lactic acid", "glycerol", "ethyl lactate", "dihydrolevoglucosenone", "cyrene", "2-methyltetrahydrofuran", "2-methf", "limonene", "d-limonene", "p-cymene", "gamma-valerolactone", "gvl", "ethyl acetate", "etoac", "isopropyl acetate", "dimethyl carbonate", "propylene carbonate", "cellulose", "starch", "chitosan", "chitin", "sucrose", "glucose", "fructose", "xylose", "amino acid", "peptide", "protein", "fatty acid", "oleic acid", "palmitic acid", "soybean oil", "palm oil", "coconut oil", "castor oil", "linseed oil", "terpene", "pinene", "camphor", "citric acid", "tartaric acid", "malic acid", "furan", "furfural", "hmf", "5-hydroxymethylfurfural", "levulinic acid", "itaconic acid", "succinic acid", "sorbitol", "mannitol", "xylitol", "polylactic acid", "pla"}


def is_renewable(name: str) -> bool:
    return name.lower().strip() in RENEWABLE_CHEMICALS


def score_p7(chemicals: list[ChemicalInput]) -> PrincipleScore:
    """Calculate renewable mass fraction without inventing unreported masses."""
    excluded_roles = {"product", "desired product", "byproduct", "target", "final product"}
    scoreable = [c for c in chemicals if c.role.lower().strip() not in excluded_roles]
    if not scoreable:
        return PrincipleScore(principle_number=7, principle_name="Use of Renewable Feedstocks", score=5.0, normalized=0.5, details={"note": "No input chemicals identified"}, confidence="benchmark", data_sources=["renewable_db"])
    missing_inputs = missing_mass_inputs(scoreable)
    if missing_inputs:
        return unavailable_score(principle_number=7, principle_name="Use of Renewable Feedstocks", missing_inputs=missing_inputs, provenance=MASS_PROVENANCE, data_sources=["renewable_db"])

    unknown_classifications = [
        {"chemical": chem.name, "input": "renewable_classification", "reason": "unavailable"}
        for chem in scoreable
        if not is_renewable(chem.name)
    ]
    if unknown_classifications:
        return unavailable_score(principle_number=7, principle_name="Use of Renewable Feedstocks", missing_inputs=unknown_classifications, provenance="unavailable: a verified feedstock-origin classification is required for every evaluated chemical", data_sources=["renewable_db"])

    renewable_mass = total_mass = 0.0
    flagged: list[str] = []
    chem_details: list[dict] = []
    for chem in scoreable:
        mass_g, renewable = chem.quantity_g, is_renewable(chem.name)
        assert mass_g is not None
        total_mass += mass_g
        if renewable:
            renewable_mass += mass_g
        else:
            flagged.append(chem.name)
        chem_details.append({"name": chem.name, "role": chem.role, "is_renewable": renewable, "mass_g": round(mass_g, 2)})
    petroleum_fraction = 1.0 - renewable_mass / total_mass
    score = min(10.0, round(petroleum_fraction * 10.0, 2))
    return PrincipleScore(principle_number=7, principle_name="Use of Renewable Feedstocks", score=score, normalized=round(score / 10.0, 4), details={"renewable_mass_g": round(renewable_mass, 2), "total_mass_g": round(total_mass, 2), "renewable_fraction": round(1.0 - petroleum_fraction, 4), "chemicals": chem_details}, chemicals_flagged=flagged, data_sources=["renewable_db"], confidence="calculated")
