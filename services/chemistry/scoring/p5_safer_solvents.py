"""P5: Design for Safer Solvents and Auxiliaries

Deterministic scoring using CHEM21 solvent guide classifications
weighted by mass. A protocol's P5 score reflects how hazardous
its solvent choices are, scaled by how much of each is used.

Score: 0 (all recommended solvents) to 10 (all highly hazardous)

Packet A: solvent role filter is now narrowed.

    A chemical is treated as a solvent when ANY of:
      (a) its role is in the explicit solvent-family set
          (``solvent``, ``co-solvent``, ``washing solvent``, ``auxiliary``), OR
      (b) its process-use / role signals workup/extraction/wash AND its
          identity resolves to a curated CHEM21 solvent. This handles
          legacy protocols that label ethyl acetate ``workup`` rather
          than ``solvent``.

    We do NOT blindly widen ``workup`` to all workup chemicals — salts
    like ``Na2CO3`` and ``NaCl`` that the protocol lists under workup/wash
    are excluded unless their identity verifies as a curated solvent.

    A 100g/chemical fabricated default for missing mass has been removed.
"""

from scoring.input_honesty import (
    MASS_PROVENANCE,
    missing_mass_inputs,
    unavailable_score,
)
from scoring.models import ChemicalInput, PrincipleScore, ScoreProvenance
from chem21 import lookup_solvent
from identity import preferred_identity_name
from solvent_evidence_store import SolventEvidenceUnavailableError


SOLVENT_ROLES = frozenset({
    "solvent", "co-solvent", "washing solvent", "auxiliary",
})
# Roles that, in legacy protocols, may carry a real solvent under a
# non-solvent role label. We only treat them as solvent when the
# CHEM21 identity check confirms the curated solvent name.
SOLVENT_PROCESS_USE = frozenset({
    "workup", "extraction", "wash",
})


def _chem21_unavailable(error: SolventEvidenceUnavailableError) -> PrincipleScore:
    return PrincipleScore(
        principle_number=5,
        principle_name="Safer Solvents and Auxiliaries",
        score=-1.0,
        normalized=-1.0,
        details={"error": f"CHEM21 data unavailable: {error}"},
        confidence=ScoreProvenance.UNAVAILABLE,
        data_sources=[],
    )


# Weight multipliers for CHEM21 classifications
CLASS_WEIGHTS = {
    "recommended": 0.0,
    "problematic": 0.4,
    "hazardous": 0.7,
    "highly_hazardous": 1.0,
}


def _is_solvent(chem: ChemicalInput) -> bool:
    """Narrow solvent filter — see module docstring.

    Returns True when the chemical belongs to the explicit solvent role
    set, OR its process-use signals workup/extraction/wash AND its
    identity resolves to a curated CHEM21 solvent.
    """
    role = chem.role.lower().strip()
    if role in SOLVENT_ROLES:
        return True
    # process_use (parent-populated) takes precedence over legacy role labels.
    process_use = (chem.process_use or "").lower().strip()
    if process_use and process_use not in SOLVENT_PROCESS_USE:
        # An explicit non-solvent process_use disqualifies the chemical
        # from the solvent filter.
        return False
    if role in SOLVENT_PROCESS_USE or (process_use and process_use in SOLVENT_PROCESS_USE):
        # Identity check — only include if CHEM21 recognises the name.
        # We let SolventEvidenceUnavailableError propagate so the caller
        # can convert it to an UNAVAILABLE score.
        entry = lookup_solvent(
            preferred_identity_name(chem.reference_name or chem.name)
        )
        return entry is not None
    return False


def score_p5(chemicals: list[ChemicalInput]) -> PrincipleScore:
    """Score Principle 5: Safer Solvents and Auxiliaries.

    Method: For each solvent, look up CHEM21 classification and
    weight by mass fraction. Non-solvents are ignored.
    """
    # Packet A: solvent filter is now identity-verified for legacy workup
    # roles. Errors here propagate to an UNAVAILABLE score; legitimate
    # non-solvents simply return False from _is_solvent.
    try:
        solvents = [c for c in chemicals if _is_solvent(c)]
    except SolventEvidenceUnavailableError as error:
        return _chem21_unavailable(error)

    if not solvents:
        return PrincipleScore(
            principle_number=5,
            principle_name="Safer Solvents and Auxiliaries",
            score=0.0,
            normalized=0.0,
            details={
                "_summary": "No solvents identified in protocol.",
                "note": "No solvents identified in protocol",
            },
            confidence=ScoreProvenance.CALCULATED,
            data_sources=["chem21"],
        )

    # Packet A honesty: a missing declared mass must not produce a 100g
    # fabrication. If any solvent lacks quantity_g we return unavailable
    # with provenance so the UI can surface that explicitly.
    missing_mass = missing_mass_inputs(solvents)
    if missing_mass:
        return unavailable_score(
            principle_number=5,
            principle_name="Safer Solvents and Auxiliaries",
            missing_inputs=missing_mass,
            provenance=MASS_PROVENANCE,
            data_sources=["chem21"],
            details={
                "_summary": (
                    "Solvent score unavailable — one or more identified solvents "
                    "lack a declared finite positive quantity_g."
                ),
            },
        )

    total_mass_g = 0.0
    weighted_hazard = 0.0
    flagged: list[str] = []
    solvent_details: list[dict] = []

    for chem in solvents:
        mass_g = chem.quantity_g  # type: ignore[assignment]  # verified finite positive

        try:
            entry = lookup_solvent(preferred_identity_name(chem.reference_name or chem.name))
        except SolventEvidenceUnavailableError as error:
            return _chem21_unavailable(error)

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
                "process_use": chem.process_use,
                "role": chem.role,
            })
        else:
            # A stated solvent without guide evidence cannot disappear from
            # the denominator and make the remaining solvents look safer.
            return unavailable_score(
                principle_number=5,
                principle_name="Safer Solvents and Auxiliaries",
                missing_inputs=[{"chemical": chem.name, "input": "chem21_classification", "reason": "unavailable"}],
                provenance="unavailable: curated solvent classification missing",
                data_sources=["chem21"],
            )

    # Normalize: 0 = all recommended, 10 = all highly hazardous
    raw_score = (weighted_hazard / total_mass_g * 10) if total_mass_g > 0 else 0
    score = min(10.0, round(raw_score, 2))

    return PrincipleScore(
        principle_number=5,
        principle_name="Safer Solvents and Auxiliaries",
        score=score,
        normalized=round(score / 10.0, 4),
        details={
            "_summary": (
                f"{round(total_mass_g, 1):.0f} g total solvent; "
                f"{len(flagged)} solvent(s) of concern per CHEM21 guide."
            ),
            "total_solvent_mass_g": round(total_mass_g, 2),
            "solvents": solvent_details,
        },
        chemicals_flagged=flagged,
        data_sources=["chem21"],
        confidence=ScoreProvenance.CALCULATED,
    )
