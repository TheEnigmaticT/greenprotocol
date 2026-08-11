"""Compatibility adapter for the local CHEM21 solvent evidence index."""

from __future__ import annotations

from dataclasses import dataclass

from solvent_evidence_schema import normalize_identity
from solvent_evidence_store import get_store


CHEM21_CITATION = {
    "source_id": "CHEM21",
    "source_name": "CHEM21 Solvent Selection Guide",
    "citation": "Prat et al., Green Chem., 2016, 18, 288-296",
    "url": "https://doi.org/10.1039/C5GC01008J",
    "doi": "10.1039/C5GC01008J",
}

# Historical shorthand is lookup compatibility, not a second source of CHEM21 data.
_COMPATIBILITY_ALIASES = {
    "h2o": "Water",
    "deionized water": "Water",
    "etoh": "Ethanol",
    "ipa": "Isopropyl alcohol",
    "ipoh": "Isopropyl alcohol",
    "2-propanol": "Isopropyl alcohol",
    "1-butanol": "n-Butanol",
    "buoh": "n-Butanol",
    "etoac": "Ethyl acetate",
    "mek": "Methyl ethyl ketone",
    "2-butanone": "Methyl ethyl ketone",
    "meoh": "Methanol",
    "acoh": "Acetic acid",
    "n-heptane": "Heptane",
    "dimethyl sulfoxide": "Dimethyl sulfoxide",
    "acn": "Acetonitrile",
    "mecn": "Acetonitrile",
    "thf": "Tetrahydrofuran",
    "2-methf": "Methyl tetrahydrofuran",
    "2-methyltetrahydrofuran": "Methyl tetrahydrofuran",
    "et2o": "Diethyl ether",
    "ether": "Diethyl ether",
    "1,4-dioxane": "Dioxane",
    "dcm": "Dichloromethane",
    "dmf": "N,N-Dimethylformamide",
    "dma": "N,N-Dimethylacetamide",
    "dmac": "N,N-Dimethylacetamide",
    "nmp": "N-Methyl-2-pyrrolidinone",
    "chcl3": "Chloroform",
    "ccl4": "Carbon tetrachloride",
    "dce": "1,2-Dichloroethane",
    "n-hexane": "Hexane",
    "hexanes": "Hexane",
    "dipe": "Diisopropyl ether",
    "isopropanol": "Isopropyl alcohol",
    "isopropyl acetate": "Isopropylacetate",
    "methylcyclohexane": "Methyl cyclohexane",
}


@dataclass(frozen=True)
class SolventEntry:
    name: str
    classification: str
    safety: int
    health: int
    environment: int
    overall: int


def _evidence_row(name: str) -> dict | None:
    store = get_store()
    row = store.lookup_chem21(name)
    if row is not None:
        return row
    canonical = _COMPATIBILITY_ALIASES.get(normalize_identity(name))
    return store.lookup_chem21(canonical) if canonical is not None else None


def lookup_solvent(name: str) -> SolventEntry | None:
    """Look up a solvent in the generated CHEM21 evidence index."""
    row = _evidence_row(name)
    if row is None:
        return None
    scores = row["scores"]
    return SolventEntry(
        name=row["name"],
        classification=row["classification"],
        safety=scores["safety"],
        health=scores["health"],
        environment=scores["environment"],
        overall=scores["overall"],
    )


def lookup_solvent_with_evidence(name: str) -> dict | None:
    """Look up a solvent with CHEM21's citable evidence and replacements."""
    row = _evidence_row(name)
    if row is None:
        return None
    response = {
        "name": row["name"],
        "classification": row["classification"],
        "scores": row["scores"],
        "evidence": CHEM21_CITATION,
    }
    if row.get("replacements"):
        response["replacements"] = row["replacements"]
    return response


def classify_solvent(name: str) -> str:
    """Return a CHEM21 classification, or ``unknown`` for an unlisted solvent."""
    entry = lookup_solvent(name)
    return entry.classification if entry else "unknown"


def get_vetted_evidence(chemical_name: str, cid: int | None = None) -> dict:
    """Consolidate CHEM21 evidence in the legacy evidence-response shape."""
    evidence = {"why_flagged": [], "why_replacement": [], "citations": []}
    c21 = lookup_solvent_with_evidence(chemical_name)
    if c21 is None or c21["classification"] == "recommended":
        return evidence

    evidence["why_flagged"].append({
        "source": "CHEM21",
        "content": (
            f"Classified as '{c21['classification']}' in CHEM21 selection guide "
            f"(Score: {c21['scores']['overall']}/10)."
        ),
    })
    evidence["citations"].append(c21["evidence"])
    for replacement in c21.get("replacements", []):
        evidence["why_replacement"].append({
            "chemical": replacement,
            "source": "CHEM21",
            "content": "CHEM21 lists this as a replacement option.",
        })
    return evidence
