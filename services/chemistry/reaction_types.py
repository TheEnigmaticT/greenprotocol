"""Reaction type classification and ACS GCI benchmark data.

Efficiency and PMI benchmarks by reaction class, sourced from
ACS Green Chemistry Institute Pharmaceutical Roundtable data
and published green chemistry literature.

Sources:
- Jimenez-Gonzalez et al., Org. Process Res. Dev. 2011, 15, 912
- Sheldon, Green Chem. 2017, 19, 18
- ACS GCI PMI Calculator benchmark datasets
"""

from dataclasses import dataclass


@dataclass
class ReactionBenchmark:
    reaction_type: str
    typical_efficiency: float   # 0-1 (fraction yield)
    efficiency_range: tuple[float, float]  # (low, high)
    typical_pmi: float
    pmi_range: tuple[float, float]
    category: str  # coupling, substitution, addition, etc.


# ACS GCI benchmark data by reaction type
REACTION_BENCHMARKS: dict[str, ReactionBenchmark] = {}


def _add(key: str, name: str, eff: float, eff_range: tuple,
         pmi: float, pmi_range: tuple, cat: str):
    REACTION_BENCHMARKS[key.lower()] = ReactionBenchmark(
        reaction_type=name, typical_efficiency=eff,
        efficiency_range=eff_range, typical_pmi=pmi,
        pmi_range=pmi_range, category=cat,
    )

# --- Coupling reactions ---
_add("amide_coupling", "Amide Bond Formation / Peptide Coupling",
     0.70, (0.55, 0.85), 25, (15, 50), "coupling")
_add("suzuki_coupling", "Suzuki-Miyaura Cross-Coupling",
     0.75, (0.60, 0.90), 30, (15, 60), "coupling")
_add("heck_coupling", "Heck Reaction",
     0.70, (0.50, 0.85), 35, (20, 70), "coupling")
_add("sonogashira", "Sonogashira Coupling",
     0.72, (0.55, 0.88), 30, (15, 55), "coupling")
_add("buchwald_hartwig", "Buchwald-Hartwig Amination",
     0.70, (0.50, 0.85), 35, (20, 65), "coupling")
_add("click_chemistry", "CuAAC Click Chemistry",
     0.85, (0.75, 0.95), 12, (5, 25), "coupling")
_add("cuaac", "CuAAC Click Chemistry",
     0.85, (0.75, 0.95), 12, (5, 25), "coupling")

# --- Substitution ---
_add("nucleophilic_substitution", "Nucleophilic Substitution (SN2/SN1)",
     0.75, (0.60, 0.90), 20, (8, 40), "substitution")
_add("electrophilic_aromatic", "Electrophilic Aromatic Substitution",
     0.70, (0.50, 0.85), 25, (12, 50), "substitution")
_add("esterification", "Fischer Esterification",
     0.80, (0.65, 0.92), 15, (8, 30), "substitution")
_add("acetylation", "Acetylation",
     0.82, (0.70, 0.92), 12, (6, 25), "substitution")
_add("alkylation", "Alkylation",
     0.72, (0.55, 0.88), 22, (10, 45), "substitution")

# --- Addition ---
_add("diels_alder", "Diels-Alder Cycloaddition",
     0.80, (0.65, 0.95), 10, (5, 20), "addition")
_add("michael_addition", "Michael Addition",
     0.78, (0.60, 0.90), 15, (8, 30), "addition")
_add("aldol", "Aldol Condensation",
     0.72, (0.55, 0.85), 20, (10, 40), "addition")
_add("grignard", "Grignard Reaction",
     0.70, (0.50, 0.85), 30, (15, 60), "addition")

# --- Reduction / Oxidation ---
_add("hydrogenation", "Catalytic Hydrogenation",
     0.88, (0.75, 0.98), 10, (5, 20), "redox")
_add("reduction_borohydride", "Borohydride Reduction",
     0.82, (0.70, 0.92), 18, (10, 30), "redox")
_add("reduction_lialh4", "LiAlH4 Reduction",
     0.75, (0.60, 0.88), 25, (12, 45), "redox")
_add("oxidation", "General Oxidation",
     0.68, (0.50, 0.82), 30, (15, 60), "redox")
_add("swern_oxidation", "Swern Oxidation",
     0.72, (0.55, 0.85), 35, (20, 65), "redox")

# --- Protection / Deprotection ---
_add("fmoc_deprotection", "Fmoc Deprotection",
     0.90, (0.80, 0.98), 20, (10, 40), "protection")
_add("boc_deprotection", "Boc Deprotection",
     0.92, (0.85, 0.98), 15, (8, 30), "protection")
_add("protection", "General Protecting Group Installation",
     0.80, (0.65, 0.92), 20, (10, 40), "protection")
_add("deprotection", "General Deprotection",
     0.88, (0.75, 0.95), 15, (8, 30), "protection")

# --- Solid-phase synthesis ---
_add("spps", "Solid-Phase Peptide Synthesis",
     0.65, (0.45, 0.80), 50, (25, 120), "solid_phase")
_add("solid_phase", "General Solid-Phase Synthesis",
     0.65, (0.45, 0.80), 50, (25, 120), "solid_phase")

# --- Other ---
_add("crystallization", "Crystallization / Recrystallization",
     0.85, (0.70, 0.95), 10, (5, 20), "purification")
_add("distillation", "Distillation",
     0.88, (0.75, 0.95), 8, (4, 15), "purification")
_add("extraction", "Liquid-Liquid Extraction",
     0.80, (0.65, 0.92), 15, (8, 30), "purification")
_add("fermentation", "Biocatalytic Fermentation",
     0.60, (0.40, 0.80), 40, (20, 100), "biocatalysis")
_add("enzymatic", "Enzymatic Catalysis",
     0.82, (0.65, 0.95), 15, (5, 35), "biocatalysis")


def lookup_benchmark(reaction_type: str) -> ReactionBenchmark | None:
    """Look up ACS GCI benchmarks for a reaction type."""
    return REACTION_BENCHMARKS.get(reaction_type.lower().strip())


def get_all_reaction_types() -> list[str]:
    """Return all known reaction type keys for LLM prompt context."""
    return sorted(set(b.reaction_type for b in REACTION_BENCHMARKS.values()))
