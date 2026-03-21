"""CHEM21 solvent selection guide data.

Classifications: recommended, problematic, hazardous, highly_hazardous
Scores: 1-3 (green/recommended), 4-6 (yellow/problematic), 
        7-9 (red/hazardous), 10 (highly hazardous)

Source: Prat et al., Green Chem., 2016, 18, 288-296
DOI: 10.1039/C5GC01008J
"""

from dataclasses import dataclass


@dataclass
class SolventEntry:
    name: str
    classification: str  # recommended, problematic, hazardous, highly_hazardous
    safety: int     # 1-10
    health: int     # 1-10
    environment: int  # 1-10
    overall: int    # 1-10 (max of safety, health, env)


# CHEM21 solvent guide — 53 classical + less-classical solvents
# Scores from the published guide (safety, health, environment)
CHEM21_SOLVENTS: dict[str, SolventEntry] = {}

def _add(name: str, cls: str, s: int, h: int, e: int, *aliases: str):
    entry = SolventEntry(name=name, classification=cls, safety=s,
                         health=h, environment=e, overall=max(s, h, e))
    CHEM21_SOLVENTS[name.lower()] = entry
    for a in aliases:
        CHEM21_SOLVENTS[a.lower()] = entry

# RECOMMENDED solvents (green, scores 1-3)
_add("Water", "recommended", 1, 1, 1, "h2o", "deionized water")
_add("Ethanol", "recommended", 3, 2, 1, "etoh")
_add("Isopropanol", "recommended", 3, 2, 1, "ipa", "ipoh", "2-propanol")
_add("1-Butanol", "recommended", 3, 2, 1, "buoh", "n-butanol")
_add("Ethyl acetate", "recommended", 3, 2, 1, "etoac")
_add("Isopropyl acetate", "recommended", 3, 2, 1)
_add("Methyl ethyl ketone", "recommended", 3, 2, 1, "mek", "2-butanone")
_add("Acetone", "recommended", 3, 1, 1)
_add("Methanol", "recommended", 3, 3, 1, "meoh")
_add("Acetic acid", "recommended", 3, 3, 1, "acoh")
_add("Sulfolane", "recommended", 1, 3, 1)
_add("Heptane", "recommended", 3, 2, 1, "n-heptane")
_add("Anisole", "recommended", 3, 2, 1)
_add("p-Cymene", "recommended", 3, 1, 1)
_add("Dihydrolevoglucosenone", "recommended", 2, 2, 1, "cyrene")

# PROBLEMATIC solvents (yellow, scores 4-6)
_add("Toluene", "problematic", 3, 5, 3)
_add("Cyclohexane", "problematic", 3, 3, 5)
_add("Methylcyclohexane", "problematic", 3, 3, 5)
_add("DMSO", "problematic", 1, 4, 1, "dimethyl sulfoxide")
_add("Acetonitrile", "problematic", 3, 4, 3, "acn", "mecn")
_add("Tetrahydrofuran", "problematic", 5, 4, 3, "thf")
_add("2-Methyltetrahydrofuran", "problematic", 5, 4, 3, "2-methf")
_add("Xylene", "problematic", 3, 5, 5, "xylenes")
_add("Diethyl ether", "problematic", 5, 4, 3, "et2o", "ether")
_add("1,4-Dioxane", "problematic", 5, 5, 3, "dioxane")

# HAZARDOUS solvents (red, scores 7-9)
_add("Dichloromethane", "hazardous", 3, 7, 5, "dcm")
_add("N,N-Dimethylformamide", "hazardous", 1, 7, 3, "dmf")
_add("N,N-Dimethylacetamide", "hazardous", 1, 7, 3, "dma", "dmac")
_add("N-Methyl-2-pyrrolidone", "hazardous", 1, 7, 3, "nmp")
_add("Pyridine", "hazardous", 3, 7, 3)
_add("Chloroform", "hazardous", 1, 7, 5, "chcl3")
_add("Dimethyl sulfate", "hazardous", 1, 9, 3)
_add("Formic acid", "hazardous", 3, 7, 1)
_add("Nitromethane", "hazardous", 7, 5, 3)

# HIGHLY HAZARDOUS solvents (brown, score 10)
_add("Carbon tetrachloride", "highly_hazardous", 1, 10, 7, "ccl4")
_add("1,2-Dichloroethane", "highly_hazardous", 3, 10, 7, "dce")
_add("Benzene", "highly_hazardous", 3, 10, 5)
_add("Hexane", "highly_hazardous", 3, 5, 7, "n-hexane", "hexanes")
_add("Pentane", "highly_hazardous", 7, 3, 5)
_add("Diisopropyl ether", "highly_hazardous", 7, 4, 5, "dipe")


def lookup_solvent(name: str) -> SolventEntry | None:
    """Look up a solvent in the CHEM21 guide."""
    return CHEM21_SOLVENTS.get(name.lower().strip())


def classify_solvent(name: str) -> str:
    """Get the CHEM21 classification for a solvent.
    
    Returns: recommended, problematic, hazardous, highly_hazardous, or unknown
    """
    entry = lookup_solvent(name)
    return entry.classification if entry else "unknown"
