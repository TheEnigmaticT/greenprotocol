"""US RCRA hazardous-waste regulatory-context mapping.

Maps protocol chemicals to federal RCRA waste codes (40 CFR 261) as a
**compliance-context evidence layer** — NOT a scoring input and NOT legal
advice. Two signal sources:

1. Listed wastes (40 CFR 261.33) — curated P-list (acutely hazardous) and
   U-list (toxic commercial chemical) entries, matched by chemical name /
   synonym. These codes apply specifically to *discarded unused* commercial
   chemical products, off-spec product, and residues — not to spent reaction
   mixtures. We surface them as context, flagged accordingly.

2. Characteristic wastes (40 CFR 261.21-.24) — derived deterministically:
   - Toxicity (D004-D043): curated TCLP contaminant list, matched by name.
   - Ignitability (D001): from GHS flammable-liquid H-codes (flash pt < 60 °C).
   - Corrosivity (D002): heuristic from GHS corrosive classification
     (RCRA D002 is strictly aqueous pH <= 2 or >= 12.5; H-codes are a proxy).
   - Reactivity (D003): from GHS explosive / self-reactive / water-reactive
     H-codes.

Coverage is intentionally a curated subset of common laboratory chemicals;
gaps are reported via `coverageComplete: false` so the UI can say so plainly.
State programs may list additional wastes; this layer is federal-baseline only.
"""

from __future__ import annotations

from typing import Sequence

from .models import ChemicalInput

FRAMEWORK = "US RCRA (40 CFR 261), federal baseline"

DISCLAIMER = (
    "Decision-support context derived from US RCRA (40 CFR 261). Not legal "
    "advice and not used in green-chemistry scoring. P- and U-list codes apply "
    "to discarded unused commercial chemicals and product residues, not to spent "
    "reaction mixtures. State programs may regulate additional wastes. Verify "
    "applicability with your EHS / waste authority before relying on these codes."
)


# ── Curated listed + toxicity-characteristic table (40 CFR 261.24, 261.33) ──
# Each entry: canonical name, CAS (display/citation only), optional U/P code,
# optional toxicity-characteristic D-code + TCLP regulatory level, and the
# synonyms used for name matching at scoring time.

_ENTRIES: list[dict] = [
    {"name": "Methanol", "cas": "67-56-1", "uCode": "U154",
     "synonyms": ["methanol", "methyl alcohol", "meoh"]},
    {"name": "Chloroform", "cas": "67-66-3", "uCode": "U044",
     "dCode": "D022", "level": "6.0 mg/L",
     "synonyms": ["chloroform", "trichloromethane"]},
    {"name": "Toluene", "cas": "108-88-3", "uCode": "U220",
     "synonyms": ["toluene", "methylbenzene", "toluol"]},
    {"name": "Acetone", "cas": "67-64-1", "uCode": "U002",
     "synonyms": ["acetone", "2-propanone", "propan-2-one", "dimethyl ketone"]},
    {"name": "Methylene chloride", "cas": "75-09-2", "uCode": "U080",
     "synonyms": ["methylene chloride", "dichloromethane", "dcm", "methylene dichloride"]},
    {"name": "Benzene", "cas": "71-43-2", "uCode": "U019",
     "dCode": "D018", "level": "0.5 mg/L",
     "synonyms": ["benzene", "benzol"]},
    {"name": "Carbon tetrachloride", "cas": "56-23-5", "uCode": "U211",
     "dCode": "D019", "level": "0.5 mg/L",
     "synonyms": ["carbon tetrachloride", "tetrachloromethane"]},
    {"name": "Ethyl acetate", "cas": "141-78-6", "uCode": "U112",
     "synonyms": ["ethyl acetate", "etoac", "ethyl ethanoate"]},
    {"name": "Methyl ethyl ketone", "cas": "78-93-3", "uCode": "U159",
     "dCode": "D035", "level": "200.0 mg/L",
     "synonyms": ["methyl ethyl ketone", "mek", "2-butanone", "butanone", "butan-2-one"]},
    {"name": "Pyridine", "cas": "110-86-1", "uCode": "U196",
     "dCode": "D038", "level": "5.0 mg/L",
     "synonyms": ["pyridine", "azabenzene"]},
    {"name": "Phenol", "cas": "108-95-2", "uCode": "U188",
     "synonyms": ["phenol", "carbolic acid", "hydroxybenzene"]},
    {"name": "Trichloroethylene", "cas": "79-01-6", "uCode": "U228",
     "dCode": "D040", "level": "0.5 mg/L",
     "synonyms": ["trichloroethylene", "trichloroethene", "tce"]},
    {"name": "Tetrachloroethylene", "cas": "127-18-4", "uCode": "U210",
     "dCode": "D039", "level": "0.7 mg/L",
     "synonyms": ["tetrachloroethylene", "tetrachloroethene", "perchloroethylene", "perc"]},
    {"name": "Xylene", "cas": "1330-20-7", "uCode": "U239",
     "synonyms": ["xylene", "xylenes", "dimethylbenzene"]},
    {"name": "Formaldehyde", "cas": "50-00-0", "uCode": "U122",
     "synonyms": ["formaldehyde", "methanal", "formalin"]},
    {"name": "Nitrobenzene", "cas": "98-95-3", "uCode": "U169",
     "dCode": "D036", "level": "2.0 mg/L",
     "synonyms": ["nitrobenzene", "nitrobenzol"]},
    {"name": "Aniline", "cas": "62-53-3", "uCode": "U012",
     "synonyms": ["aniline", "aminobenzene", "phenylamine"]},
    {"name": "1,4-Dioxane", "cas": "123-91-1", "uCode": "U108",
     "synonyms": ["1,4-dioxane", "dioxane", "p-dioxane"]},
    {"name": "Sodium cyanide", "cas": "143-33-9", "pCode": "P106",
     "synonyms": ["sodium cyanide", "nacn"]},
    {"name": "Sodium azide", "cas": "26628-22-8", "pCode": "P105",
     "synonyms": ["sodium azide", "nan3"]},
    {"name": "Osmium tetroxide", "cas": "20816-12-0", "pCode": "P087",
     "synonyms": ["osmium tetroxide", "osmium(viii) oxide", "oso4"]},
    # Toxicity-characteristic metals (40 CFR 261.24, the 8 RCRA metals).
    {"name": "Arsenic", "cas": "7440-38-2", "dCode": "D004", "level": "5.0 mg/L",
     "synonyms": ["arsenic"]},
    {"name": "Barium", "cas": "7440-39-3", "dCode": "D005", "level": "100.0 mg/L",
     "synonyms": ["barium"]},
    {"name": "Cadmium", "cas": "7440-43-9", "dCode": "D006", "level": "1.0 mg/L",
     "synonyms": ["cadmium"]},
    {"name": "Chromium", "cas": "7440-47-3", "dCode": "D007", "level": "5.0 mg/L",
     "synonyms": ["chromium"]},
    {"name": "Lead", "cas": "7439-92-1", "dCode": "D008", "level": "5.0 mg/L",
     "synonyms": ["lead"]},
    {"name": "Mercury", "cas": "7439-97-6", "dCode": "D009", "level": "0.2 mg/L",
     "synonyms": ["mercury"]},
    {"name": "Selenium", "cas": "7782-49-2", "dCode": "D010", "level": "1.0 mg/L",
     "synonyms": ["selenium"]},
    {"name": "Silver", "cas": "7440-22-4", "dCode": "D011", "level": "5.0 mg/L",
     "synonyms": ["silver"]},
]


def _norm(s: str) -> str:
    """Normalize a name for matching: lowercase, collapse separators."""
    return "".join(ch for ch in s.lower().strip() if ch.isalnum())


# Build indexes once at import time: by normalized synonym, and by CAS.
_NAME_INDEX: dict[str, dict] = {}
_CAS_INDEX: dict[str, dict] = {}
for _e in _ENTRIES:
    _CAS_INDEX[_e["cas"]] = _e
    for _syn in _e["synonyms"]:
        _NAME_INDEX.setdefault(_norm(_syn), _e)


# ── GHS H-code -> RCRA characteristic heuristics ──
_IGNITABLE_HCODES = {"H224", "H225"}            # flammable liquid, flash pt < 60 C
_CORROSIVE_HCODES = {"H290", "H314"}            # corrosive (proxy for pH extreme)
_REACTIVE_HCODES = {
    "H200", "H201", "H202", "H203", "H204",     # explosives
    "H240", "H241",                              # self-reactive / explosive when heated
    "H260", "H261",                              # water-reactive, emits flammable gas
    "H271", "H272",                              # strong oxidizers
}


def _listed_signal(entry: dict) -> dict | None:
    if entry.get("pCode"):
        return {
            "code": entry["pCode"],
            "type": "listed_acute",
            "label": "Listed acutely hazardous waste (P-list)",
            "basis": "Acutely hazardous commercial chemical if discarded unused (40 CFR 261.33(e)).",
            "regulatoryLevel": None,
        }
    if entry.get("uCode"):
        return {
            "code": entry["uCode"],
            "type": "listed_toxic",
            "label": "Listed toxic commercial chemical (U-list)",
            "basis": "Toxic commercial chemical if discarded unused (40 CFR 261.33(f)).",
            "regulatoryLevel": None,
        }
    return None


def _tox_char_signal(entry: dict) -> dict | None:
    if entry.get("dCode"):
        return {
            "code": entry["dCode"],
            "type": "characteristic_toxicity",
            "label": "Toxicity characteristic (TCLP)",
            "basis": "Regulated toxicity-characteristic contaminant (40 CFR 261.24).",
            "regulatoryLevel": entry.get("level"),
        }
    return None


def _characteristic_from_hcodes(hcodes: list[str]) -> list[dict]:
    codes = set(hcodes)
    signals: list[dict] = []
    if codes & _IGNITABLE_HCODES:
        signals.append({
            "code": "D001",
            "type": "characteristic_ignitability",
            "label": "Ignitability characteristic",
            "basis": "GHS flammable-liquid classification implies flash point < 60 °C (40 CFR 261.21).",
            "regulatoryLevel": None,
        })
    if codes & _CORROSIVE_HCODES:
        signals.append({
            "code": "D002",
            "type": "characteristic_corrosivity",
            "label": "Corrosivity characteristic (heuristic)",
            "basis": "GHS corrosive classification; RCRA D002 is strictly aqueous pH <= 2 or >= 12.5 (40 CFR 261.22).",
            "regulatoryLevel": None,
        })
    if codes & _REACTIVE_HCODES:
        signals.append({
            "code": "D003",
            "type": "characteristic_reactivity",
            "label": "Reactivity characteristic",
            "basis": "GHS explosive / self-reactive / water-reactive classification (40 CFR 261.23).",
            "regulatoryLevel": None,
        })
    return signals


def compute_regulatory_context(
    chemicals: Sequence[ChemicalInput],
    hcodes_map: dict[str, list[str]],
    cas_map: dict[str, str] | None = None,
) -> dict:
    """Map chemicals to RCRA regulatory-context signals.

    Args:
        chemicals: parsed chemicals (name-keyed; CAS may be absent).
        hcodes_map: chemical name -> list of GHS H-codes.
        cas_map: optional chemical name -> CAS, used for display/citation only.

    Returns:
        A dict matching the RegulatoryContext TypeScript interface.
    """
    cas_map = cas_map or {}
    out_chemicals: list[dict] = []
    distinct: set[str] = set()

    for chem in chemicals:
        signals: list[dict] = []
        # Prefer CAS match (authoritative) when a CAS is known; fall back to
        # name/synonym matching.
        cas = cas_map.get(chem.name)
        entry = _CAS_INDEX.get(cas) if cas else None
        if entry is None:
            entry = _NAME_INDEX.get(_norm(chem.name))
        if entry:
            for sig in (_listed_signal(entry), _tox_char_signal(entry)):
                if sig:
                    signals.append(sig)

        signals.extend(_characteristic_from_hcodes(hcodes_map.get(chem.name, [])))

        if not signals:
            continue

        for sig in signals:
            distinct.add(sig["code"])

        out_chemicals.append({
            "chemical": chem.name,
            "cas": (entry or {}).get("cas") or cas,
            "signals": signals,
        })

    # Sort codes: D-characteristics, then D-toxicity, then P, then U — roughly
    # by how directly they bind regardless of disposal intent.
    def _rank(code: str) -> tuple[int, str]:
        prefix = {"D": 0, "P": 1, "U": 2}.get(code[0], 3)
        return (prefix, code)

    return {
        "framework": FRAMEWORK,
        "disclaimer": DISCLAIMER,
        "coverageComplete": False,
        "chemicalsScreened": len(chemicals),
        "chemicalsWithSignals": len(out_chemicals),
        "distinctCodes": sorted(distinct, key=_rank),
        "chemicals": out_chemicals,
    }
