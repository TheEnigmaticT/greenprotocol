"""P4: Designing Safer Chemicals (Product Toxicity)

Deterministic scoring using GHS health hazard codes for
products and desired outputs only. Focuses on the toxicity
of what the protocol produces, not what it consumes.

Score: 0 (non-toxic products) to 10 (highly toxic/CMR products)
"""

from scoring.models import ChemicalInput, PrincipleScore, ScoreProvenance
from scoring.input_honesty import GHS_PROVENANCE, missing_hcodes_inputs, unavailable_score
from ghs import score_health_hazard, is_cmr

PRODUCT_ROLES = {
    "product", "desired product", "target", "intermediate",
    "final product", "main product",
}


def score_p4(
    chemicals: list[ChemicalInput],
    hcodes_map: dict[str, list[str]],
) -> PrincipleScore:
    """Score Principle 4: Designing Safer Chemicals.
    
    Same GHS scoring as P3 but filtered to products only.
    """
    products = [c for c in chemicals
                if c.role.lower().strip() in PRODUCT_ROLES
                or "product" in c.role.lower()]

    if not products:
        # Packet A honesty: no products identified means there is no
        # chemical-design target to evaluate. The principle is genuinely
        # unavailable — score -1 pairs with confidence=UNAVAILABLE.
        return PrincipleScore(
            principle_number=4,
            principle_name="Designing Safer Chemicals",
            score=-1.0, normalized=-1.0,
            details={"note": "No products identified in protocol. "
                     "Molecular design scope - out of range for protocol analysis."},
            confidence=ScoreProvenance.UNAVAILABLE,
            data_sources=[],  # No data sources when unavailable
        )

    missing = missing_hcodes_inputs(products, hcodes_map)
    if missing:
        return unavailable_score(
            principle_number=4,
            principle_name="Designing Safer Chemicals",
            missing_inputs=missing,
            provenance=GHS_PROVENANCE,
            data_sources=["pubchem_ghs"],
        )

    max_health = 0.0
    any_cmr = False
    flagged: list[str] = []
    product_details: list[dict] = []

    for chem in products:
        codes = hcodes_map.get(chem.name, [])
        health = score_health_hazard(codes)
        cmr = is_cmr(codes)

        max_health = max(max_health, health)
        if cmr:
            any_cmr = True

        if health >= 5 or cmr:
            flagged.append(chem.name)

        product_details.append({
            "name": chem.name,
            "role": chem.role,
            "health_score": health,
            "is_cmr": cmr,
            "hcodes": codes,
        })

    # Product toxicity scored by worst product
    # CMR products get a floor of 8
    score = max_health
    if any_cmr and score < 8:
        score = 8.0
    score = min(10.0, round(score, 2))

    return PrincipleScore(
        principle_number=4,
        principle_name="Designing Safer Chemicals",
        score=score,
        normalized=round(score / 10.0, 4),
        details={
            "products_evaluated": len(products),
            "products": product_details,
            "has_cmr_product": any_cmr,
        },
        chemicals_flagged=flagged,
        data_sources=["pubchem_ghs"],
        confidence=ScoreProvenance.CALCULATED if products else ScoreProvenance.UNAVAILABLE,
    )
