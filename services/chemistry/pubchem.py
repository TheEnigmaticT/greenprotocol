"""PubChem PUG-REST API client for chemical property lookups."""

import httpx
import re

PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
TIMEOUT = 15.0


async def lookup_properties(name: str) -> dict | None:
    """Look up MW, formula, SMILES for a chemical by name."""
    url = (
        f"{PUBCHEM_BASE}/compound/name/{name}"
        f"/property/MolecularWeight,MolecularFormula,"
        f"CanonicalSMILES,IsomericSMILES/JSON"
    )
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return None
            data = resp.json()
            props = data["PropertyTable"]["Properties"][0]
            return {
                "cid": props.get("CID"),
                "molecular_weight": float(props.get("MolecularWeight", 0)),
                "molecular_formula": props.get("MolecularFormula"),
                "canonical_smiles": props.get("CanonicalSMILES"),
                "isomeric_smiles": props.get("IsomericSMILES"),
            }
    except Exception:
        return None


async def lookup_density(cid: int) -> float | None:
    """Look up density from PubChem PUG-View for a given CID."""
    url = (
        f"https://pubchem.ncbi.nlm.nih.gov/rest/pug_view"
        f"/data/compound/{cid}/JSON"
        f"?heading=Density"
    )
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return None
            data = resp.json()
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
        return None
    
    density = None
    if props.get("cid"):
        density = await lookup_density(props["cid"])
    
    return {
        **props,
        "density_g_per_ml": density,
    }
