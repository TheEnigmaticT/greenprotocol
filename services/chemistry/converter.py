"""Core conversion logic: chemical name + quantity -> standardized units."""

from models import ConvertResponse
from parser import parse_quantity
from synonyms import resolve_synonym
from pubchem import lookup_chemical
import cache

try:
    from rdkit import Chem
    from rdkit.Chem import Descriptors
    RDKIT_AVAILABLE = True
except ImportError:
    RDKIT_AVAILABLE = False


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
    resolved_name = resolve_synonym(chemical_name)
    was_synonym = resolved_name.lower() != chemical_name.lower().strip()

    # Check cache first
    cached_data = cache.get(resolved_name)
    if cached_data:
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
        cache.put(resolved_name, pubchem_data)
        return _build_response(
            pubchem_data, chemical_name, resolved_name, quantity,
            data_source="pubchem", cached=False, warnings=warnings,
        )

    # RDKit fallback — can only help if we somehow have SMILES
    warnings.append(f"Chemical '{resolved_name}' not found in PubChem")
    return _build_response(
        {}, chemical_name, resolved_name, quantity,
        data_source="not_found", cached=False, warnings=warnings,
    )


def _build_response(
    chem_data: dict,
    original_name: str,
    resolved_name: str,
    quantity: str,
    data_source: str,
    cached: bool,
    warnings: list[str],
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
        chemical_name=resolved_name,
        cas=None,  # TODO: extract CAS from PubChem PUG-View
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
        data_source=data_source,
        cached=cached,
        warnings=warnings,
    )
