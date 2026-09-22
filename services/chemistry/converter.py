"""Core conversion logic: chemical name + quantity -> standardized units."""

import re

from models import ConvertResponse
from parser import parse_quantity
from chem21 import get_vetted_evidence
from ghs import last_ghs_status, lookup_hcodes_with_details
from pubchem import lookup_chemical, get_last_lookup_failure
from cas_lookup import get_cas
from identity import resolve_cached_identity, split_combined_alias_labels
from synonyms import resolve_synonym  # compatibility import for existing callers
from reference_store import get_reference_store
import cache


# These protocol materials are mixtures or undefined compositions rather than
# single compounds. They cannot receive a meaningful PubChem molecular
# reference and must not be reported as recoverable lookup misses.
INDEFINITE_CHEMICALS = {
    "brine",
    "cellulose acetate",
}

# A named diazonium salt can be looked up. "Diazonium salt" cannot.
_IDENTIFIABLE_DIAZONIUM = re.compile(
    r"\b(chloride|bromide|iodide|tetrafluoroborate|tosylate|benzene|phenyl|aryl|arene)\b"
)


# Numbered eluent / solvent mixture strings, e.g. hexane/ethyl acetate (4:1).
_RATIO_IN_NAME = re.compile(r"\d+\s*:\s*\d+")


def is_indefinite_material(name: str) -> bool:
    key = name.lower().strip()
    if key in INDEFINITE_CHEMICALS:
        return True
    if re.search(r"\bdiazonium\b", key) and not _IDENTIFIABLE_DIAZONIUM.search(key):
        return True
    # Slash mixture with a numeric ratio is an indefinite composition (not a
    # PubChem miss). Bare slash pairs like aniline/HCl are left alone.
    if "/" in key and _RATIO_IN_NAME.search(key):
        return True
    return False

try:
    from rdkit import Chem
    from rdkit.Chem import Descriptors
    RDKIT_AVAILABLE = True
except ImportError:
    RDKIT_AVAILABLE = False


def _ghs_needs_fetch(cached_data: dict) -> bool:
    """Empty hazards without a confirmed read are a failed lookup, not a clean result."""
    if "ghs_hazards" not in cached_data:
        return True
    if cached_data.get("ghs_status") == "confirmed":
        return False
    return not cached_data.get("ghs_hazards")


async def _apply_ghs(target: dict, cid: int | None) -> None:
    if not cid:
        return
    details = await lookup_hcodes_with_details(cid)
    if last_ghs_status() == "confirmed":
        target["ghs_hazards"] = details
        target["ghs_status"] = "confirmed"
        return
    target.pop("ghs_hazards", None)
    target.pop("ghs_status", None)


def _rdkit_mw(smiles: str) -> float | None:
    if not RDKIT_AVAILABLE or not smiles:
        return None
    try:
        mol = Chem.MolFromSmiles(smiles)
        if mol:
            return round(Descriptors.MolWt(mol), 4)
    except Exception:
        pass
    return None


def _resolve_cached_alias(name: str) -> tuple[str, dict | None]:
    """Resolve an exact cached/known identity without fuzzy label cleanup."""
    return resolve_cached_identity(name, cache.get)


async def convert(chemical_name: str, quantity: str) -> ConvertResponse:
    """Convert a chemical name + quantity string to standardized units.
    
    Pipeline:
    1. Resolve synonyms (DMF -> N,N-Dimethylformamide)
    2. Check cache
    3. Look up PubChem (MW, density, SMILES, CAS)
    4. RDKit fallback for MW if PubChem fails
    5. Parse quantity string
    6. Convert: mL->g (density), g->mol (MW), mol->g (MW)
    """
    warnings: list[str] = []
    resolved_name, cached_data = _resolve_cached_alias(chemical_name)
    was_synonym = resolved_name.lower() != chemical_name.lower().strip()
    combined_labels = split_combined_alias_labels(chemical_name)

    if (
        is_indefinite_material(resolved_name)
        or any(is_indefinite_material(label) for label in combined_labels)
    ):
        warnings.append(
            "This material has an indefinite composition and cannot be analyzed as a single chemical."
        )
        return _build_response(
            {}, chemical_name, resolved_name, quantity,
            data_source="indefinite", cached=False, warnings=warnings,
            reference_status="indefinite",
        )

    # Check process/seed cache, then the durable shared cache.
    if not cached_data:
        cached_data = await get_reference_store().get_cache(resolved_name)
        if cached_data:
            cache.put(resolved_name, cached_data)
    if cached_data:
        # Re-fetch evidence even for cached if it's missing (migration support).
        # An empty hazard list is only final after a confirmed read.
        needs_ghs = _ghs_needs_fetch(cached_data)
        needs_alts = "green_alternatives" not in cached_data
        if needs_ghs or needs_alts:
            if needs_alts:
                evidence = get_vetted_evidence(resolved_name, cached_data.get("cid"))
                cached_data["green_alternatives"] = evidence["why_replacement"]
                cached_data["citations"] = evidence["citations"]
            if needs_ghs:
                await _apply_ghs(cached_data, cached_data.get("cid"))
            cache.put(resolved_name, cached_data)

        return _build_response(
            cached_data, chemical_name, resolved_name, quantity,
            data_source="cache", cached=True, warnings=warnings,
        )

    # PubChem lookup
    pubchem_data = await lookup_chemical(resolved_name)
    
    # If synonym lookup failed, try original name
    if not pubchem_data and was_synonym:
        pubchem_data = await lookup_chemical(chemical_name)

    if pubchem_data:
        # Augment with GHS details and Green Alternatives evidence
        cid = pubchem_data.get("cid")
        if cid:
            await _apply_ghs(pubchem_data, cid)
            
        evidence = get_vetted_evidence(resolved_name, cid)
        pubchem_data["green_alternatives"] = evidence["why_replacement"]
        pubchem_data["citations"] = evidence["citations"]
        
        cache.put(resolved_name, pubchem_data)
        # Durable writes are best-effort for successful foreground lookups.
        await get_reference_store().upsert_cache(resolved_name, pubchem_data)
        return _build_response(
            pubchem_data, chemical_name, resolved_name, quantity,
            data_source=pubchem_data.get("_data_source", "pubchem"),
            cached=False, warnings=warnings,
        )

    failure = get_last_lookup_failure() or {"status": "retryable", "error_code": "network"}
    failure_status = failure.get("status")
    if failure_status == "terminal_not_found":
        reference_status = "terminal_not_found"
    elif failure_status == "retryable":
        queued = await get_reference_store().enqueue_miss(
            resolved_name, retryable=True, http_status=failure.get("http_status"), error_code=failure.get("error_code", "network")
        )
        reference_status = "queued" if queued else "unavailable"
    else:
        reference_status = "unavailable"

    warnings.append(f"Chemical '{resolved_name}' not found in PubChem")
    return _build_response(
        {}, chemical_name, resolved_name, quantity,
        data_source="not_found", cached=False, warnings=warnings,
        reference_status=reference_status, reference_queued=reference_status == "queued",
    )


def _build_response(
    chem_data: dict,
    original_name: str,
    resolved_name: str,
    quantity: str,
    data_source: str,
    cached: bool,
    warnings: list[str],
    reference_status: str = "available",
    reference_queued: bool = False,
) -> ConvertResponse:
    mw = chem_data.get("molecular_weight")
    density = chem_data.get("density_g_per_ml")
    smiles = chem_data.get("canonical_smiles")

    # RDKit MW validation/fallback
    if smiles and RDKIT_AVAILABLE:
        rdkit_mw = _rdkit_mw(smiles)
        if rdkit_mw:
            if mw and abs(mw - rdkit_mw) > 1.0:
                warnings.append(
                    f"MW mismatch: PubChem={mw:.2f}, RDKit={rdkit_mw:.2f}"
                )
            if not mw:
                mw = rdkit_mw
                data_source = "rdkit"

    # Parse quantity
    parsed = parse_quantity(quantity)
    quantity_g: float | None = None
    quantity_kg: float | None = None
    quantity_mol: float | None = None

    if parsed:
        if parsed.base_unit == "g":
            quantity_g = parsed.base_value
        elif parsed.base_unit == "mL":
            if density:
                quantity_g = parsed.base_value * density
            else:
                warnings.append("No density available; cannot convert mL to g")
        elif parsed.base_unit == "mol":
            quantity_mol = parsed.base_value
            if mw:
                quantity_g = parsed.base_value * mw
        elif parsed.base_unit == "equiv":
            warnings.append("Equivalents require a reference molar amount")

        # g -> kg
        if quantity_g is not None:
            quantity_kg = quantity_g / 1000.0

        # g -> mol (if we have MW and didn't start from mol)
        if quantity_g is not None and mw and mw > 0 and quantity_mol is None:
            quantity_mol = quantity_g / mw

    return ConvertResponse(
        chemical_name=original_name,
        cas=get_cas(resolved_name) or get_cas(original_name),
        smiles=smiles,
        molecular_formula=chem_data.get("molecular_formula"),
        molecular_weight=round(mw, 4) if mw else None,
        density_g_per_ml=round(density, 4) if density else None,
        input_quantity=quantity,
        parsed_value=parsed.value if parsed else None,
        parsed_unit=parsed.unit if parsed else None,
        quantity_g=round(quantity_g, 6) if quantity_g is not None else None,
        quantity_kg=round(quantity_kg, 8) if quantity_kg is not None else None,
        quantity_mol=round(quantity_mol, 8) if quantity_mol is not None else None,
        ghs_hazards=chem_data.get("ghs_hazards", []),
        green_alternatives=chem_data.get("green_alternatives", []),
        citations=chem_data.get("citations", []),
        data_source=data_source,
        cached=cached,
        reference_status=reference_status,
        reference_queued=reference_queued,
        reference_queueed=reference_queued,
        warnings=warnings,
    )
