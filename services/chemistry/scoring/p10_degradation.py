"""P10: Design for Degradation

Deterministic scoring using GHS environmental hazard codes
weighted by quantity. Chemicals with aquatic toxicity and
persistence score worst.

Score: 0 (all biodegradable) to 10 (persistent environmental hazards)

Packet A honesty: a chemical absent from ``hcodes_map`` (unknown hazard
evidence) OR present with an empty list (no evidence returned) is treated
as missing evidence — the principle returns an explicit unavailable
score rather than grading the remaining subset or collapsing the absent
chemical into a verified-zero hazard. Non-empty codes whose contents do
not match the evaluated environmental hazard class still support a real
score of 0.
"""

from scoring.input_honesty import (
    GHS_PROVENANCE,
    MASS_PROVENANCE,
    unavailable_score,
)
from scoring.models import ChemicalInput, PrincipleScore, ScoreProvenance
from ghs import score_environmental_hazard


def _missing_evidence(
    chemicals: list[ChemicalInput],
    hcodes_map: dict[str, list[str]],
) -> list[dict[str, str]]:
    """Identify chemicals whose hazard evidence is absent or empty.

    ``hcodes_map.get(name, [])`` collapses both 'lookup did not return' and
    'lookup returned nothing' into ``[]``. Both cases are conservatively
    treated as missing evidence so an unknown chemical cannot be silently
    graded as safe (0).
    """
    missing: list[dict[str, str]] = []
    for chemical in chemicals:
        codes = hcodes_map.get(chemical.name)
        if codes is None or len(codes) == 0:
            missing.append(
                {
                    "chemical": chemical.name,
                    "input": "hcodes",
                    "reason": "unavailable" if codes is None else "empty",
                }
            )
    return missing


def _missing_mass(chemicals: list[ChemicalInput]) -> list[dict[str, str]]:
    """Local mirror of ``input_honesty.missing_mass_inputs`` filtered by role.

    The packet helper treats every chemical uniformly; P10 evaluates all
    chemicals (including products) for environmental hazard, so the mass
    check applies to the same set as the hazard check.
    """
    from scoring.input_honesty import missing_mass_inputs
    return missing_mass_inputs(chemicals)


def score_p10(
    chemicals: list[ChemicalInput],
    hcodes_map: dict[str, list[str]],
) -> PrincipleScore:
    """Score Principle 10: Design for Degradation.

    Args:
        chemicals: parsed chemicals from protocol
        hcodes_map: {chemical_name: [H-codes]} from PubChem
    """
    if not chemicals:
        return PrincipleScore(
            principle_number=10,
            principle_name="Design for Degradation",
            score=0.0, normalized=0.0,
            details={"note": "No chemicals to evaluate"},
            confidence=ScoreProvenance.CALCULATED,
            data_sources=["pubchem_ghs"],
        )

    # Packet A honesty: unknown or empty hazard evidence is not safety.
    missing_haz = _missing_evidence(chemicals, hcodes_map)
    if missing_haz:
        return unavailable_score(
            principle_number=10,
            principle_name="Design for Degradation",
            missing_inputs=missing_haz,
            provenance=GHS_PROVENANCE,
            data_sources=["pubchem_ghs"],
            details={
                "_summary": (
                    "Environmental hazard score unavailable — one or more "
                    "evaluated chemicals have no GHS hazard evidence on "
                    "record. Cannot score degradation without silently "
                    "grading the remaining subset."
                ),
            },
        )

    # Packet A honesty: missing declared mass would require fabricating a
    # 10g/chemical filler to compute a mass-weighted environmental hazard.
    # Return unavailable instead of guessing.
    missing_mass = _missing_mass(chemicals)
    if missing_mass:
        return unavailable_score(
            principle_number=10,
            principle_name="Design for Degradation",
            missing_inputs=missing_mass,
            provenance=MASS_PROVENANCE,
            data_sources=["pubchem_ghs"],
            details={
                "_summary": (
                    "Environmental hazard score unavailable — one or more "
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
        env_score = score_environmental_hazard(codes)
        mass_g = chem.quantity_g  # type: ignore[assignment]  # verified finite positive

        weighted_hazard += mass_g * (env_score / 10.0)
        total_mass_g += mass_g

        if env_score >= 5:
            flagged.append(chem.name)

        chem_details.append({
            "name": chem.name,
            "env_score": env_score,
            "env_hcodes": [c for c in codes if c.startswith("H4")],
            "mass_g": round(mass_g, 2),
        })

    raw_score = (weighted_hazard / total_mass_g * 10) if total_mass_g > 0 else 0
    score = min(10.0, round(raw_score, 2))

    return PrincipleScore(
        principle_number=10,
        principle_name="Design for Degradation",
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
