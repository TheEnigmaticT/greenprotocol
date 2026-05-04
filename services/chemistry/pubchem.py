"""PubChem PUG-REST API client for chemical property lookups."""

import httpx
import re
import asyncio
from urllib.parse import quote
from local_chem_data import lookup_local_properties

PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
TIMEOUT = 15.0
PUBCHEM_HEADERS = {
    "Accept": "application/json",
    "User-Agent": (
        "GreenProtoCol/0.1 "
        "(greenchemistry.ai; contact: support@greenchemistry.ai)"
    ),
}


async def fetch_pubchem_json(url: str, label: str) -> dict | None:
    async with httpx.AsyncClient(timeout=TIMEOUT, headers=PUBCHEM_HEADERS) as client:
        for attempt in range(3):
            resp = await client.get(url)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in {429, 500, 502, 503, 504} and attempt < 2:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            print(f"[pubchem] lookup failed for {label}: HTTP {resp.status_code}")
            return None
    return None


async def lookup_properties(name: str) -> dict | None:
    """Look up MW, formula, SMILES for a chemical by name."""
    encoded_name = quote(name.strip(), safe="")
    url = (
        f"{PUBCHEM_BASE}/compound/name/{encoded_name}"
        f"/property/MolecularWeight,MolecularFormula,"
        f"CanonicalSMILES,IsomericSMILES,SMILES,ConnectivitySMILES/JSON"
    )
    try:
        data = await fetch_pubchem_json(url, repr(name))
        if not data:
            return None
        props = data["PropertyTable"]["Properties"][0]
        canonical_smiles = (
            props.get("CanonicalSMILES")
            or props.get("SMILES")
            or props.get("ConnectivitySMILES")
        )
        isomeric_smiles = props.get("IsomericSMILES") or canonical_smiles
        return {
            "cid": props.get("CID"),
            "molecular_weight": float(props.get("MolecularWeight", 0)),
            "molecular_formula": props.get("MolecularFormula"),
            "canonical_smiles": canonical_smiles,
            "isomeric_smiles": isomeric_smiles,
        }
    except Exception as err:
        print(f"[pubchem] lookup error for {name!r}: {err}")
        return None


async def lookup_density(cid: int) -> float | None:
    """Look up density from PubChem PUG-View for a given CID."""
    url = (
        f"https://pubchem.ncbi.nlm.nih.gov/rest/pug_view"
        f"/data/compound/{cid}/JSON"
        f"?heading=Density"
    )
    try:
        data = await fetch_pubchem_json(url, f"density CID {cid}")
        if not data:
            return None
        # Navigate the nested PUG-View structure
        sections = data.get("Record", {}).get("Section", [])
        for section in sections:
            for sub in section.get("Section", []):
                for subsub in sub.get("Section", []):
                    if subsub.get("TOCHeading") == "Density":
                        for info in subsub.get("Information", []):
                            val = info.get("Value", {})
                            sval = val.get("StringWithMarkup", [{}])[0].get("String", "")
                            # Extract first number from density string
                            match = re.search(r"([\d.]+)", sval)
                            if match:
                                density = float(match.group(1))
                                # Sanity check: most liquid densities 0.5-2.5
                                if 0.3 <= density <= 5.0:
                                    return density
        return None
    except Exception:
        return None


async def lookup_chemical(name: str) -> dict | None:
    """Full lookup: properties + density."""
    props = await lookup_properties(name)
    if not props:
        local = lookup_local_properties(name)
        if local:
            print(f"[pubchem] using local fallback for {name!r}")
            return {**local, "_data_source": "local_fallback"}
        return None
    
    density = None
    if props.get("cid"):
        density = await lookup_density(props["cid"])
    
    return {
        **props,
        "density_g_per_ml": density,
    }
