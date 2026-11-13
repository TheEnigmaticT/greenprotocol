"""P1: Prevention / Process Mass Intensity (PMI).

Protocol PMI requires measured input masses and one identified measured product
mass. Stated yield, reactant molecular weight and atom economy do not by
themselves establish a product mass. A sourced reaction-type PMI benchmark may
be reported separately as BENCHMARK, never as a protocol-derived output mass.
"""
from __future__ import annotations

import math

from scoring.input_honesty import MASS_PROVENANCE, missing_mass_inputs, unavailable_score
from scoring.models import ChemicalInput, PrincipleScore, ScoreProvenance
from scoring.roles import PRODUCT_ROLES, is_product_role, normalize_role


def _finite_positive(value: float | None) -> bool:
    return value is not None and math.isfinite(value) and value > 0


def score_p1(
    chemicals: list[ChemicalInput],
    yield_pct: float | None = None,
    yield_source: str = "unknown",
    reaction_type: str | None = None,
    benchmark_efficiency: float | None = None,
    benchmark_pmi: float | None = None,
    atom_economy_pct: float | None = None,
) -> PrincipleScore:
    """Calculate measured PMI or explicitly report a benchmark-only proxy.

    Yield/efficiency/atom-economy arguments remain accepted for caller
    compatibility but are not substitutes for a measured product mass.
    """
    principle_name = "Prevention (Waste / PMI)"
    inputs = [c for c in chemicals if not is_product_role(c.role)]
    # Byproducts are excluded from inputs but are not the desired denominator.
    outputs = [c for c in chemicals if normalize_role(c.role) in PRODUCT_ROLES]
    if not inputs:
        return unavailable_score(
            principle_number=1, principle_name=principle_name,
            missing_inputs=[{"chemical": "", "input": "input_chemicals", "reason": "no_inputs"}],
            provenance=MASS_PROVENANCE, data_sources=["unit_converter"],
        )
    missing = missing_mass_inputs(inputs)
    if missing:
        return unavailable_score(
            principle_number=1, principle_name=principle_name, missing_inputs=missing,
            provenance=MASS_PROVENANCE, data_sources=["unit_converter"],
        )
    total_input_g = sum(c.quantity_g for c in inputs)  # type: ignore[misc]
    if len(outputs) > 1:
        return unavailable_score(
            principle_number=1, principle_name=principle_name,
            missing_inputs=[{"chemical": c.name, "input": "desired_product_scope", "reason": "multiple_declared_outputs"} for c in outputs],
            provenance="unavailable: identify one desired product and its measured mass; outputs were not silently combined or selected",
            data_sources=["unit_converter"], details={"total_input_g": total_input_g},
        )
    product_mass_g = outputs[0].quantity_g if outputs and _finite_positive(outputs[0].quantity_g) else None
    benchmark = benchmark_pmi if _finite_positive(benchmark_pmi) else None
    if product_mass_g is not None:
        pmi = total_input_g / product_mass_g
        method = "measured_product_mass"
        confidence = ScoreProvenance.CALCULATED
    elif benchmark is not None:
        pmi = benchmark
        method = "benchmark_pmi_only"
        confidence = ScoreProvenance.BENCHMARK
    else:
        return unavailable_score(
            principle_number=1, principle_name=principle_name,
            missing_inputs=[{"chemical": outputs[0].name if outputs else "desired product", "input": "product_mass_g", "reason": "not_measured"}],
            provenance="unavailable: measured product mass missing; yield and reactant weight do not establish product mass",
            data_sources=["unit_converter"],
            details={"_summary": "PMI unavailable — no measured product mass and no reaction type PMI benchmark.",
                     "total_input_g": total_input_g, "product_mass_g": None, "yield_pct": yield_pct},
        )
    score = 0.0 if pmi <= 1 else min(10.0, round(math.log10(pmi) * 5.0, 2))
    vs_benchmark = None
    if benchmark is not None:
        vs_benchmark = "better_than_typical" if pmi < benchmark * .8 else "worse_than_typical" if pmi > benchmark * 1.2 else "typical"
    if method == "benchmark_pmi_only":
        summary = f"Benchmark-only PMI = {round(pmi, 2):.1f}; product mass was not derived from this protocol."
    else:
        assert product_mass_g is not None  # measured-product branch invariant
        summary = (f"PMI = {round(pmi, 2):.1f} ({total_input_g:g} g input → "
                   f"{product_mass_g:g} g declared product). ")
        summary += (f"vs. {reaction_type} benchmark PMI {benchmark}: {vs_benchmark.replace('_', ' ')}."
                    if vs_benchmark else "No benchmark available.")
    return PrincipleScore(
        principle_number=1, principle_name=principle_name, score=score, normalized=round(score / 10, 4),
        details={"_summary": summary, "pmi": round(pmi, 2), "total_input_g": round(total_input_g, 2),
                 "product_mass_g": round(product_mass_g, 2) if product_mass_g is not None else None,
                 "yield_pct": yield_pct, "yield_source": yield_source, "reaction_type": reaction_type,
                 "benchmark_pmi": benchmark, "vs_benchmark": vs_benchmark, "method": method},
        data_sources=["unit_converter", "acs_gci_benchmarks"] if benchmark is not None else ["unit_converter"],
        confidence=confidence,
    )
