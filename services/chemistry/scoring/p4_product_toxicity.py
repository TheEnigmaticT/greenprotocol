"""P4: Designing Safer Chemicals (Product Toxicity)

Deterministic scoring using GHS health hazard codes for
products and desired outputs only. Focuses on the toxicity
of what the protocol produces, not what it consumes.

Score: 0 (non-toxic products) to 10 (highly toxic/CMR products)
"""

from scoring.models import ChemicalInput, PrincipleScore
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
        return PrincipleScore(
            principle_number=4,
            principle_name="Designing Safer Chemicals",
            score=0.0, normalized=0.0,
            details={"note": "No products identified in protocol. "
                     "Score based on LLM assessment."},
            confidence="partial",
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
        confidence="calculated" if products else "partial",
    )
