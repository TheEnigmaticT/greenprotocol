"""P4: Designing Safer Chemicals (Product Toxicity)."""

from scoring.models import ChemicalInput, PrincipleScore
from ghs import is_cmr, score_health_hazard
from scoring.input_honesty import GHS_PROVENANCE, missing_hcodes_inputs, unavailable_score

PRODUCT_ROLES = {"product", "desired product", "target", "intermediate", "final product", "main product"}


def score_p4(chemicals: list[ChemicalInput], hcodes_map: dict[str, list[str]]) -> PrincipleScore:
    """Score product toxicity from known product GHS data; no mass is needed."""
    products = [c for c in chemicals if c.role.lower().strip() in PRODUCT_ROLES or "product" in c.role.lower()]
    if not products:
        return unavailable_score(principle_number=4, principle_name="Designing Safer Chemicals", missing_inputs=[{"input": "product_identity", "reason": "no_product_identified"}], provenance="unavailable: no product was identified for product-toxicity assessment", data_sources=[], details={"note": "No products identified in protocol. Molecular design scope - out of range for protocol analysis."})
    missing_inputs = missing_hcodes_inputs(products, hcodes_map)
    if missing_inputs:
        return unavailable_score(principle_number=4, principle_name="Designing Safer Chemicals", missing_inputs=missing_inputs, provenance=GHS_PROVENANCE, data_sources=["pubchem_ghs"])

    max_health, any_cmr = 0.0, False
    flagged: list[str] = []
    product_details: list[dict] = []
    for chem in products:
        codes = hcodes_map[chem.name]
        health, cmr = score_health_hazard(codes), is_cmr(codes)
        max_health, any_cmr = max(max_health, health), any_cmr or cmr
        if health >= 5 or cmr:
            flagged.append(chem.name)
        product_details.append({"name": chem.name, "role": chem.role, "health_score": health, "is_cmr": cmr, "hcodes": codes})
    score = max(8.0, max_health) if any_cmr else max_health
    score = min(10.0, round(score, 2))
    return PrincipleScore(principle_number=4, principle_name="Designing Safer Chemicals", score=score, normalized=round(score / 10.0, 4), details={"products_evaluated": len(products), "products": product_details, "has_cmr_product": any_cmr}, chemicals_flagged=flagged, data_sources=["pubchem_ghs"], confidence="calculated")
