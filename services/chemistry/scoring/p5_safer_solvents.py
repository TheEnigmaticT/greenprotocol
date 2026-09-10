"""P5: Design for Safer Solvents and Auxiliaries, weighted by declared mass."""

from scoring.models import ChemicalInput, PrincipleScore
from chem21 import lookup_solvent
from solvent_evidence_store import SolventEvidenceUnavailableError
from scoring.input_honesty import MASS_PROVENANCE, missing_mass_inputs, unavailable_score

CLASS_WEIGHTS = {"recommended": 0.0, "problematic": 0.4, "hazardous": 0.7, "highly_hazardous": 1.0}


def _chem21_unavailable(error: SolventEvidenceUnavailableError) -> PrincipleScore:
    return unavailable_score(principle_number=5, principle_name="Safer Solvents and Auxiliaries", missing_inputs=[{"input": "chem21_evidence", "reason": "unavailable"}], provenance="unavailable: CHEM21 solvent evidence could not be read", data_sources=[], details={"error": f"CHEM21 data unavailable: {error}"})


def score_p5(chemicals: list[ChemicalInput]) -> PrincipleScore:
    """Score solvents only when CHEM21 class and finite positive mass are known."""
    solvents = [c for c in chemicals if c.role.lower() in ("solvent", "washing solvent", "co-solvent", "auxiliary")]
    if not solvents:
        return PrincipleScore(principle_number=5, principle_name="Safer Solvents and Auxiliaries", score=0.0, normalized=0.0, details={"_summary": "No solvents identified in protocol.", "note": "No solvents identified in protocol"}, confidence="calculated", data_sources=["chem21"])
    missing_inputs = missing_mass_inputs(solvents)
    if missing_inputs:
        return unavailable_score(principle_number=5, principle_name="Safer Solvents and Auxiliaries", missing_inputs=missing_inputs, provenance=MASS_PROVENANCE, data_sources=["chem21"])

    total_mass_g = weighted_hazard = 0.0
    flagged: list[str] = []
    solvent_details: list[dict] = []
    for chem in solvents:
        mass_g = chem.quantity_g
        assert mass_g is not None
        try:
            entry = lookup_solvent(chem.name)
        except SolventEvidenceUnavailableError as error:
            return _chem21_unavailable(error)
        if entry is None:
            return unavailable_score(principle_number=5, principle_name="Safer Solvents and Auxiliaries", missing_inputs=[{"chemical": chem.name, "input": "chem21_classification", "reason": "unavailable"}], provenance="unavailable: CHEM21 classification is required for every evaluated solvent", data_sources=["chem21"])
        weight = CLASS_WEIGHTS.get(entry.classification)
        if weight is None:
            return unavailable_score(principle_number=5, principle_name="Safer Solvents and Auxiliaries", missing_inputs=[{"chemical": chem.name, "input": "chem21_classification", "reason": "unrecognized"}], provenance="unavailable: CHEM21 classification is required for every evaluated solvent", data_sources=["chem21"])
        weighted_hazard += mass_g * weight
        total_mass_g += mass_g
        if entry.classification in ("hazardous", "highly_hazardous"):
            flagged.append(chem.name)
        solvent_details.append({"name": chem.name, "chem21_name": entry.name, "classification": entry.classification, "safety": entry.safety, "health": entry.health, "environment": entry.environment, "mass_g": round(mass_g, 2), "weight": weight})
    score = min(10.0, round(weighted_hazard / total_mass_g * 10, 2))
    return PrincipleScore(principle_number=5, principle_name="Safer Solvents and Auxiliaries", score=score, normalized=round(score / 10.0, 4), details={"_summary": f"{round(total_mass_g, 1):.0f} g total solvent; {len(flagged)} solvent(s) of concern per CHEM21 guide.", "total_solvent_mass_g": round(total_mass_g, 2), "solvents": solvent_details}, chemicals_flagged=flagged, data_sources=["chem21"], confidence="calculated")
