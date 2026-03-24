"""P1: Prevention / Process Mass Intensity (PMI)

PMI = total mass of all inputs / mass of desired product

Data chain:
1. Total input mass: summed from unit converter (deterministic)
2. Product mass via one of:
   a. LLM extracts stated yield from protocol (surgical call)
   b. Theoretical yield from atom economy × ACS GCI benchmark
      efficiency for the classified reaction type (deterministic)

Score: 0 (PMI=1, perfect) to 10 (PMI>=100, very wasteful)
"""

from scoring.models import ChemicalInput, PrincipleScore


def score_p1(
    chemicals: list[ChemicalInput],
    yield_pct: float | None = None,
    yield_source: str = "unknown",
    reaction_type: str | None = None,
    benchmark_efficiency: float | None = None,
    benchmark_pmi: float | None = None,
    atom_economy_pct: float | None = None,
) -> PrincipleScore:
    """Score Principle 1: Waste Prevention / PMI.
    
    Args:
        chemicals: all chemicals with resolved masses
        yield_pct: stated or inferred yield (0-100)
        yield_source: "stated", "benchmark", "unknown"
        reaction_type: classified reaction type
        benchmark_efficiency: ACS GCI typical efficiency for this type
        benchmark_pmi: ACS GCI typical PMI for comparison
        atom_economy_pct: from P2 scoring (for theoretical yield calc)
    """

    # Calculate total input mass
    total_input_g = sum(c.quantity_g or 0 for c in chemicals)
    if total_input_g <= 0:
        total_input_g = sum(10.0 for _ in chemicals)  # fallback

    # Determine product mass
    product_mass_g: float | None = None
    yield_used: float | None = None
    method = "none"

    # Method A: stated yield
    if yield_pct is not None and yield_pct > 0:
        yield_used = yield_pct
        method = "stated_yield"

    # Method B: benchmark efficiency × atom economy
    elif benchmark_efficiency is not None and atom_economy_pct is not None:
        yield_used = benchmark_efficiency * 100  # convert to pct
        method = "benchmark_yield"

    # If we have a yield and can find the limiting reagent
    if yield_used is not None:
        # Find limiting reagent (smallest molar amount among reactants)
        reactants = [c for c in chemicals
                     if c.role.lower() in ("reactant", "reagent", "starting material")
                     and c.quantity_mol and c.quantity_mol > 0]

        if reactants:
            limiting = min(reactants, key=lambda c: c.quantity_mol or float('inf'))

            # Theoretical product mass = limiting_mol × product_MW × (AE/100)
            if atom_economy_pct and limiting.molecular_weight:
                # AE tells us what fraction of reactant mass becomes product
                theoretical_product_g = (
                    (limiting.quantity_mol or 0)
                    * (limiting.molecular_weight or 0)
                    * (atom_economy_pct / 100.0)
                )
                product_mass_g = theoretical_product_g * (yield_used / 100.0)
            else:
                # Simpler: assume product is yield% of largest reactant mass
                largest_reactant_g = max(c.quantity_g or 0 for c in reactants)
                product_mass_g = largest_reactant_g * (yield_used / 100.0)
        else:
            # No reactants identified — rough estimate
            non_solvent_mass = sum(
                c.quantity_g or 0 for c in chemicals
                if c.role.lower() not in ("solvent", "washing solvent", "co-solvent")
            )
            product_mass_g = non_solvent_mass * (yield_used / 100.0) * 0.5

    # Calculate PMI
    pmi: float | None = None
    if product_mass_g and product_mass_g > 0:
        pmi = total_input_g / product_mass_g

    # If no PMI calculable, use benchmark PMI if available
    if pmi is None and benchmark_pmi:
        pmi = benchmark_pmi
        method = "benchmark_pmi_only"

    if pmi is None:
        return PrincipleScore(
            principle_number=1,
            principle_name="Prevention (Waste / PMI)",
            score=-1.0, normalized=-1.0,
            details={
                "error": "Cannot calculate PMI — no yield data and no "
                         "reaction type benchmark available",
                "total_input_g": round(total_input_g, 2),
            },
            confidence="unavailable",
            data_sources=[],
        )

    # Score: PMI 1=0/10, PMI 10=3/10, PMI 25=5/10, PMI 50=7/10, PMI 100+=10/10
    # Using log scale since PMI varies enormously
    import math
    if pmi <= 1:
        score = 0.0
    else:
        score = min(10.0, round(math.log10(pmi) * 5.0, 2))

    # Compare against benchmark if available
    vs_benchmark = None
    if benchmark_pmi:
        if pmi < benchmark_pmi * 0.8:
            vs_benchmark = "better_than_typical"
        elif pmi > benchmark_pmi * 1.2:
            vs_benchmark = "worse_than_typical"
        else:
            vs_benchmark = "typical"

    return PrincipleScore(
        principle_number=1,
        principle_name="Prevention (Waste / PMI)",
        score=score,
        normalized=round(score / 10.0, 4),
        details={
            "pmi": round(pmi, 2),
            "total_input_g": round(total_input_g, 2),
            "product_mass_g": round(product_mass_g, 2) if product_mass_g else None,
            "yield_pct": yield_used,
            "yield_source": yield_source if yield_used == yield_pct else method,
            "reaction_type": reaction_type,
            "benchmark_pmi": benchmark_pmi,
            "vs_benchmark": vs_benchmark,
            "method": method,
        },
        data_sources=["unit_converter", "acs_gci_benchmarks"] if benchmark_pmi
                     else ["unit_converter"],
        confidence="calculated" if method == "stated_yield"
                   else "benchmark" if "benchmark" in method
                   else "partial",
    )
