"""P3: Less Hazardous Chemical Syntheses

Deterministic scoring using GHS health hazard codes weighted by
quantity. A protocol's P3 score reflects the aggregate health
hazard of all chemicals used.

Score: 0 (no health hazards) to 10 (severe CMR chemicals in large qty)

Packet A: this module no longer fabricates a 10g/chemical fallback when
masses are missing, and an empty list from ``hcodes_map.get(name, [])``
no longer collapses 'no hazard evidence' into 'verified safe'. If any
evaluated chemical is missing either declared mass or hazard evidence,
the principle returns an explicit unavailable score.
"""

from scoring.input_honesty import (
    GHS_PROVENANCE,
    MASS_PROVENANCE,
    missing_hcodes_inputs,
    missing_mass_inputs,
    unavailable_score,
)
from scoring.models import ChemicalInput, PrincipleScore, ScoreProvenance
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
            score=-1.0, normalized=-1.0,
            details={"_summary": "No chemicals to evaluate.", "note": "No chemicals to evaluate"},
            confidence=ScoreProvenance.UNAVAILABLE,
            data_sources=["pubchem_ghs"],
        )

    # Packet A honesty: missing hazard evidence is not safety.
    missing_haz = missing_hcodes_inputs(chemicals, hcodes_map)
    if missing_haz:
        return unavailable_score(
            principle_number=3,
            principle_name="Less Hazardous Chemical Syntheses",
            missing_inputs=missing_haz,
            provenance=GHS_PROVENANCE,
            data_sources=["pubchem_ghs"],
            details={
                "_summary": (
                    "Hazard score unavailable — one or more evaluated chemicals "
                    "have no GHS hazard evidence on record. Cannot score health "
                    "hazard without silently grading the remaining subset."
                ),
            },
        )

    # Packet A honesty: missing declared mass would require fabricating a
    # 10g/chemical filler to compute a mass-weighted hazard. Return
    # unavailable instead of guessing.
    missing_mass = missing_mass_inputs(chemicals)
    if missing_mass:
        return unavailable_score(
            principle_number=3,
            principle_name="Less Hazardous Chemical Syntheses",
            missing_inputs=missing_mass,
            provenance=MASS_PROVENANCE,
            data_sources=["pubchem_ghs"],
            details={
                "_summary": (
                    "Hazard score unavailable — one or more evaluated chemicals "
                    "lack a declared finite positive quantity_g."
                ),
            },
        )

    total_mass_g = 0.0
    weighted_hazard = 0.0
    flagged: list[str] = []
    chem_details: list[dict] = []

    for chem in chemicals:
        # Honest: every chemical is now guaranteed to be in hcodes_map.
        codes = hcodes_map[chem.name]
        health_score = score_health_hazard(codes)
        cmr = is_cmr(codes)

        mass_g = chem.quantity_g  # type: ignore[assignment]  # verified finite positive

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
            "_summary": (
                f"{len(chem_details)} chemical(s) evaluated totalling {round(total_mass_g, 1):.0f} g; "
                f"{sum(1 for d in chem_details if d['is_cmr'])} CMR substance(s) flagged."
            ),
            "total_mass_g": round(total_mass_g, 2),
            "chemicals": chem_details,
            "cmr_chemicals_count": sum(1 for d in chem_details if d["is_cmr"]),
        },
        chemicals_flagged=flagged,
        data_sources=["pubchem_ghs"],
        confidence=ScoreProvenance.CALCULATED,
    )
