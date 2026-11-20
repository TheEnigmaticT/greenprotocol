"""P12: Inherently Safer Chemistry for Accident Prevention

Deterministic scoring using GHS physical hazard codes
weighted by quantity. Flammable, explosive, and reactive
chemicals score worst.

Score: 0 (no physical hazards) to 10 (explosive/highly flammable)

Packet A honesty: a chemical absent from ``hcodes_map`` (unknown hazard
evidence) OR present with an empty list (no evidence returned) OR carrying an
unresolved reference status is treated as missing evidence — the principle
returns an explicit unavailable score rather than grading the remaining
subset or collapsing the absent chemical into a verified-zero hazard. The
missing-evidence contract is shared with P3/P4/P10 through
``input_honesty.missing_hcodes_inputs``. Non-empty codes whose contents do
not match the evaluated physical hazard class still support a real score
of 0.
"""

from scoring.input_honesty import (
    GHS_PROVENANCE,
    MASS_PROVENANCE,
    missing_hcodes_inputs,
    missing_mass_inputs,
    unavailable_score,
)
from scoring.models import ChemicalInput, PrincipleScore, ScoreProvenance
from ghs import score_physical_hazard


def score_p12(
    chemicals: list[ChemicalInput],
    hcodes_map: dict[str, list[str]],
) -> PrincipleScore:
    """Score Principle 12: Accident Prevention.

    Args:
        chemicals: parsed chemicals from protocol
        hcodes_map: {chemical_name: [H-codes]} from PubChem
    """
    if not chemicals:
        return PrincipleScore(
            principle_number=12,
            principle_name="Inherently Safer Chemistry for Accident Prevention",
            score=0.0, normalized=0.0,
            details={"note": "No chemicals to evaluate"},
            confidence=ScoreProvenance.CALCULATED,
            data_sources=["pubchem_ghs"],
        )

    # Packet A honesty: unknown or empty hazard evidence is not safety.
    missing_haz = missing_hcodes_inputs(chemicals, hcodes_map)
    if missing_haz:
        return unavailable_score(
            principle_number=12,
            principle_name="Inherently Safer Chemistry for Accident Prevention",
            missing_inputs=missing_haz,
            provenance=GHS_PROVENANCE,
            data_sources=["pubchem_ghs"],
            details={
                "_summary": (
                    "Physical hazard score unavailable — one or more "
                    "evaluated chemicals have no GHS hazard evidence on "
                    "record. Cannot score accident prevention without "
                    "silently grading the remaining subset."
                ),
            },
        )

    # Packet A honesty: missing declared mass would require fabricating a
    # 10g/chemical filler to compute a mass-weighted physical hazard. Return
    # unavailable instead of guessing.
    missing_mass = missing_mass_inputs(chemicals)
    if missing_mass:
        return unavailable_score(
            principle_number=12,
            principle_name="Inherently Safer Chemistry for Accident Prevention",
            missing_inputs=missing_mass,
            provenance=MASS_PROVENANCE,
            data_sources=["pubchem_ghs"],
            details={
                "_summary": (
                    "Physical hazard score unavailable — one or more "
                    "evaluated chemicals lack a declared finite positive "
                    "quantity_g."
                ),
            },
        )

    total_mass_g = 0.0
    weighted_hazard = 0.0
    flagged: list[str] = []
    chem_details: list[dict] = []

    for chem in chemicals:
        # Both checks above guarantee the key is present with a non-empty list
        # and quantity_g is a finite positive number.
        codes = hcodes_map[chem.name]
        assert len(codes) > 0, "hcodes must be non-empty here"
        phys_score = score_physical_hazard(codes)
        mass_g = chem.quantity_g  # type: ignore[assignment]  # verified finite positive

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
        confidence=ScoreProvenance.CALCULATED,
    )
