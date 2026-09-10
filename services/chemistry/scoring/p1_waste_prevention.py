"""P1: Prevention / Process Mass Intensity (PMI)."""
from __future__ import annotations

import math
from scoring.models import ChemicalInput, PrincipleScore

_OUTPUT_ROLES = {"product", "desired product", "byproduct", "by-product"}


def _positive_number(value: float | None) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def _benchmark_details(reaction_type: str | None, benchmark_efficiency: float | None, benchmark_pmi: float | None) -> dict:
    return {"reaction_type": reaction_type, "benchmark_pmi": benchmark_pmi if _positive_number(benchmark_pmi) else None,
            "benchmark_efficiency_pct": round(benchmark_efficiency * 100, 2) if _positive_number(benchmark_efficiency) else None}


def _unavailable(*, error: str, total_input_g: float | None, product_mass_g: float | None, yield_pct: float | None,
                 yield_source: str, missing_input_masses: list[str], reaction_type: str | None,
                 benchmark_efficiency: float | None, benchmark_pmi: float | None) -> PrincipleScore:
    benchmark = _benchmark_details(reaction_type, benchmark_efficiency, benchmark_pmi)
    has_benchmark = benchmark["benchmark_pmi"] is not None
    return PrincipleScore(principle_number=1, principle_name="Prevention (Waste / PMI)", score=-1.0, normalized=-1.0,
        details={"_summary": "Protocol PMI unavailable; reaction-class benchmark retained as reference only." if has_benchmark else "Protocol PMI unavailable.",
                 "error": error, "pmi": None, "total_input_g": round(total_input_g, 2) if total_input_g is not None else None,
                 "product_mass_g": round(product_mass_g, 2) if _positive_number(product_mass_g) else None,
                 "product_mass_source": "declared" if _positive_number(product_mass_g) else None,
                 "yield_pct": yield_pct if _positive_number(yield_pct) and yield_pct <= 100 else None, "yield_source": yield_source,
                 "missing_input_masses": missing_input_masses, "method": "benchmark_reference_only" if has_benchmark else "unavailable",
                 "vs_benchmark": None, **benchmark}, confidence="unavailable",
        data_sources=["acs_gci_benchmarks"] if has_benchmark else [])


def score_p1(chemicals: list[ChemicalInput], yield_pct: float | None = None, yield_source: str = "unknown",
             product_mass_g: float | None = None, reaction_type: str | None = None,
             benchmark_efficiency: float | None = None, benchmark_pmi: float | None = None,
             atom_economy_pct: float | None = None) -> PrincipleScore:
    """Calculate protocol PMI only from complete process inputs and declared product mass."""
    del atom_economy_pct
    inputs = [c for c in chemicals if (c.role or "").strip().lower() not in _OUTPUT_ROLES]
    if not inputs:
        return _unavailable(error="Cannot calculate protocol PMI: no process inputs were provided.", total_input_g=None,
            product_mass_g=product_mass_g, yield_pct=yield_pct, yield_source=yield_source, missing_input_masses=[],
            reaction_type=reaction_type, benchmark_efficiency=benchmark_efficiency, benchmark_pmi=benchmark_pmi)
    missing = [c.name for c in inputs if not _positive_number(c.quantity_g)]
    if missing:
        return _unavailable(error="Cannot calculate protocol PMI: input masses are unavailable for " + ", ".join(missing) + ".",
            total_input_g=None, product_mass_g=product_mass_g, yield_pct=yield_pct, yield_source=yield_source,
            missing_input_masses=missing, reaction_type=reaction_type, benchmark_efficiency=benchmark_efficiency, benchmark_pmi=benchmark_pmi)
    total = sum(float(c.quantity_g) for c in inputs)
    if not _positive_number(product_mass_g):
        return _unavailable(error="Cannot calculate protocol PMI: an explicitly declared isolated product mass is required; a percentage yield is not converted to product mass without verified stoichiometry.",
            total_input_g=total, product_mass_g=None, yield_pct=yield_pct, yield_source=yield_source, missing_input_masses=[],
            reaction_type=reaction_type, benchmark_efficiency=benchmark_efficiency, benchmark_pmi=benchmark_pmi)
    if float(product_mass_g) > total:
        return _unavailable(error="Cannot calculate protocol PMI: declared product mass is greater than all process inputs.",
            total_input_g=total, product_mass_g=product_mass_g, yield_pct=yield_pct, yield_source=yield_source, missing_input_masses=[],
            reaction_type=reaction_type, benchmark_efficiency=benchmark_efficiency, benchmark_pmi=benchmark_pmi)
    pmi = total / float(product_mass_g)
    score = 0.0 if pmi <= 1 else min(10.0, round(math.log10(pmi) * 5.0, 2))
    benchmark = _benchmark_details(reaction_type, benchmark_efficiency, benchmark_pmi)
    value = benchmark["benchmark_pmi"]
    vs = "better_than_typical" if value and pmi < value * .8 else "worse_than_typical" if value and pmi > value * 1.2 else "typical" if value else None
    return PrincipleScore(principle_number=1, principle_name="Prevention (Waste / PMI)", score=score, normalized=round(score / 10, 4),
        details={"_summary": f"Protocol PMI = {pmi:.1f} ({total:.1f} g complete input mass → {float(product_mass_g):.1f} g declared isolated product mass).",
                 "pmi": round(pmi, 2), "total_input_g": round(total, 2), "product_mass_g": round(float(product_mass_g), 2),
                 "product_mass_source": "declared", "yield_pct": yield_pct if _positive_number(yield_pct) and yield_pct <= 100 else None,
                 "yield_source": yield_source, "missing_input_masses": [], "method": "declared_product_mass", "vs_benchmark": vs, **benchmark},
        data_sources=["unit_converter", "declared_protocol_product_mass"] + (["acs_gci_benchmarks"] if value else []), confidence="calculated")
