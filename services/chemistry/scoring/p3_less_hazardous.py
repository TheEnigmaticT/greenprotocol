"""P3: Less Hazardous Chemical Syntheses, weighted by declared mass."""

from scoring.models import ChemicalInput, PrincipleScore
from ghs import is_cmr, score_health_hazard
from scoring.input_honesty import GHS_PROVENANCE, MASS_PROVENANCE, missing_hcodes_inputs, missing_mass_inputs, unavailable_score


def score_p3(chemicals: list[ChemicalInput], hcodes_map: dict[str, list[str]]) -> PrincipleScore:
    """Score Principle 3 only when every chemical has mass and GHS evidence."""
    if not chemicals:
        return PrincipleScore(principle_number=3, principle_name="Less Hazardous Chemical Syntheses", score=0.0, normalized=0.0, details={"_summary": "No chemicals to evaluate.", "note": "No chemicals to evaluate"}, confidence="calculated", data_sources=["pubchem_ghs"])

    missing_inputs = missing_mass_inputs(chemicals)
    if missing_inputs:
        return unavailable_score(principle_number=3, principle_name="Less Hazardous Chemical Syntheses", missing_inputs=missing_inputs, provenance=MASS_PROVENANCE, data_sources=["pubchem_ghs"])
    missing_inputs = missing_hcodes_inputs(chemicals, hcodes_map)
    if missing_inputs:
        return unavailable_score(principle_number=3, principle_name="Less Hazardous Chemical Syntheses", missing_inputs=missing_inputs, provenance=GHS_PROVENANCE, data_sources=["pubchem_ghs"])

    total_mass_g = weighted_hazard = 0.0
    flagged: list[str] = []
    chem_details: list[dict] = []
    for chem in chemicals:
        codes = hcodes_map[chem.name]
        mass_g = chem.quantity_g
        assert mass_g is not None
        health_score, cmr = score_health_hazard(codes), is_cmr(codes)
        weight = health_score / 10.0
        if cmr:
            weight = min(1.0, weight * 1.5)
        weighted_hazard += mass_g * weight
        total_mass_g += mass_g
        if health_score >= 7 or cmr:
            flagged.append(chem.name)
        chem_details.append({"name": chem.name, "role": chem.role, "health_score": health_score, "is_cmr": cmr, "hcodes": codes, "mass_g": round(mass_g, 2)})

    score = min(10.0, round(weighted_hazard / total_mass_g * 10, 2))
    return PrincipleScore(principle_number=3, principle_name="Less Hazardous Chemical Syntheses", score=score, normalized=round(score / 10.0, 4), details={"_summary": f"{len(chem_details)} chemical(s) evaluated totalling {round(total_mass_g, 1):.0f} g; {sum(1 for d in chem_details if d['is_cmr'])} CMR substance(s) flagged.", "total_mass_g": round(total_mass_g, 2), "chemicals": chem_details, "cmr_chemicals_count": sum(1 for d in chem_details if d["is_cmr"])}, chemicals_flagged=flagged, data_sources=["pubchem_ghs"], confidence="calculated")
