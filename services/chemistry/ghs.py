"""GHS hazard code lookups from PubChem and scoring utilities."""

import re
import httpx
import cache as chem_cache

TIMEOUT = 15.0

# H-code categories for scoring
HEALTH_HAZARD_CODES = {
    # Acute toxicity
    "H300": 10, "H301": 8, "H302": 4, "H303": 2,  # Oral
    "H310": 10, "H311": 8, "H312": 4, "H313": 2,  # Dermal
    "H330": 10, "H331": 8, "H332": 4, "H333": 2,  # Inhalation
    # Skin/eye
    "H314": 8, "H315": 3, "H316": 1,  # Skin corrosion/irritation
    "H317": 4,  # Skin sensitization
    "H318": 6, "H319": 3, "H320": 1,  # Eye damage/irritation
    # Respiratory
    "H334": 6, "H335": 3, "H336": 3,  # Respiratory
    # CMR (carcinogenic, mutagenic, reprotoxic) — high scores
    "H340": 10, "H341": 7,  # Mutagenicity
    "H350": 10, "H351": 7,  # Carcinogenicity
    "H360": 10, "H361": 7,  # Reproductive toxicity
    "H360D": 10, "H360F": 10,
    # Organ toxicity
    "H370": 10, "H371": 7,  # Single exposure
    "H372": 8, "H373": 5,   # Repeated exposure
}

ENVIRONMENTAL_HAZARD_CODES = {
    "H400": 8, "H401": 5, "H402": 3,  # Aquatic acute
    "H410": 10, "H411": 8, "H412": 5, "H413": 3,  # Aquatic chronic
    "H420": 8,  # Ozone layer
}

PHYSICAL_HAZARD_CODES = {
    "H200": 10, "H201": 10, "H202": 8, "H203": 6,  # Explosives
    "H204": 6, "H205": 4,
    "H220": 8, "H221": 6, "H222": 6, "H223": 4,    # Flammable gases
    "H224": 8, "H225": 6, "H226": 4, "H227": 2,    # Flammable liquids
    "H228": 6,  # Flammable solids
    "H240": 10, "H241": 8, "H242": 6,  # Self-reactive
    "H250": 8, "H251": 6, "H252": 4,  # Pyrophoric/self-heating
    "H260": 8, "H261": 6,  # Water-reactive
    "H270": 6, "H271": 6, "H272": 4,  # Oxidizers
    "H280": 3, "H281": 5,  # Gases under pressure
    "H290": 3,  # Corrosive to metals
}


async def lookup_hcodes(cid: int) -> list[str]:
    """Fetch GHS H-codes for a compound from PubChem."""
    cache_key = f"ghs_{cid}"
    cached = chem_cache.get(cache_key)
    if cached:
        return cached.get("hcodes", [])

    url = (
        f"https://pubchem.ncbi.nlm.nih.gov/rest/pug_view"
        f"/data/compound/{cid}/JSON?heading=GHS+Classification"
    )
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return []
            data = resp.json()
            hcodes: set[str] = set()

            def walk(obj):
                if isinstance(obj, str):
                    for m in re.findall(r"H\d{3}[A-Za-z]*", obj):
                        hcodes.add(m)
                elif isinstance(obj, dict):
                    for v in obj.values():
                        walk(v)
                elif isinstance(obj, list):
                    for item in obj:
                        walk(item)

            walk(data)
            result = sorted(hcodes)
            chem_cache.put(cache_key, {"hcodes": result})
            return result
    except Exception:
        return []


def score_health_hazard(hcodes: list[str]) -> float:
    """Score health hazard from H-codes. Higher = more hazardous. 0-10 scale."""
    if not hcodes:
        return 0.0
    scores = [HEALTH_HAZARD_CODES.get(h, 0) for h in hcodes]
    return min(10.0, max(scores) if scores else 0.0)


def score_environmental_hazard(hcodes: list[str]) -> float:
    """Score environmental hazard from H-codes. 0-10 scale."""
    if not hcodes:
        return 0.0
    scores = [ENVIRONMENTAL_HAZARD_CODES.get(h, 0) for h in hcodes]
    return min(10.0, max(scores) if scores else 0.0)


def score_physical_hazard(hcodes: list[str]) -> float:
    """Score physical hazard from H-codes. 0-10 scale."""
    if not hcodes:
        return 0.0
    scores = [PHYSICAL_HAZARD_CODES.get(h, 0) for h in hcodes]
    return min(10.0, max(scores) if scores else 0.0)


def is_cmr(hcodes: list[str]) -> bool:
    """Check if chemical is carcinogenic, mutagenic, or reprotoxic."""
    cmr_codes = {"H340", "H341", "H350", "H351", "H360", "H360D",
                 "H360F", "H361"}
    return bool(set(hcodes) & cmr_codes)


def is_suspected_carcinogen(hcodes: list[str]) -> bool:
    return "H350" in hcodes or "H351" in hcodes
