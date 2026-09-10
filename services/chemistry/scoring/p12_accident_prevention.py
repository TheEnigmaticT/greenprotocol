"""P12: Inherently Safer Chemistry for Accident Prevention."""

from scoring.models import ChemicalInput, PrincipleScore
from ghs import score_physical_hazard
from scoring.input_honesty import GHS_PROVENANCE, MASS_PROVENANCE, missing_hcodes_inputs, missing_mass_inputs, unavailable_score


def score_p12(chemicals: list[ChemicalInput], hcodes_map: dict[str, list[str]]) -> PrincipleScore:
    if not chemicals:
        return PrincipleScore(principle_number=12, principle_name="Inherently Safer Chemistry for Accident Prevention", score=0.0, normalized=0.0, details={"note": "No chemicals to evaluate"}, confidence="calculated", data_sources=["pubchem_ghs"])
    missing_inputs = missing_mass_inputs(chemicals)
    if missing_inputs:
        return unavailable_score(principle_number=12, principle_name="Inherently Safer Chemistry for Accident Prevention", missing_inputs=missing_inputs, provenance=MASS_PROVENANCE, data_sources=["pubchem_ghs"])
    missing_inputs = missing_hcodes_inputs(chemicals, hcodes_map)
    if missing_inputs:
        return unavailable_score(principle_number=12, principle_name="Inherently Safer Chemistry for Accident Prevention", missing_inputs=missing_inputs, provenance=GHS_PROVENANCE, data_sources=["pubchem_ghs"])

    total_mass_g = weighted_hazard = 0.0
    flagged: list[str] = []
    chem_details: list[dict] = []
    for chem in chemicals:
        codes, mass_g = hcodes_map[chem.name], chem.quantity_g
        assert mass_g is not None
        phys_score = score_physical_hazard(codes)
        weighted_hazard += mass_g * (phys_score / 10.0)
        total_mass_g += mass_g
        if phys_score >= 6:
            flagged.append(chem.name)
        chem_details.append({"name": chem.name, "physical_score": phys_score, "physical_hcodes": [c for c in codes if c.startswith("H2")], "mass_g": round(mass_g, 2)})
    score = min(10.0, round(weighted_hazard / total_mass_g * 10, 2))
    return PrincipleScore(principle_number=12, principle_name="Inherently Safer Chemistry for Accident Prevention", score=score, normalized=round(score / 10.0, 4), details={"total_mass_g": round(total_mass_g, 2), "chemicals": chem_details}, chemicals_flagged=flagged, data_sources=["pubchem_ghs"], confidence="calculated")
