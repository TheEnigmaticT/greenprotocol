"""Constrained reaction-SMILES extraction from verified protocol identities.

RDKit parseability is necessary but not authority.  An inferred reaction is
accepted only when its reactants and declared product agree with verified
per-occurrence reference structures supplied by the caller.
"""

from __future__ import annotations

from typing import Any

from llm_client import call_llm

try:
    from rdkit import Chem
    RDKIT_AVAILABLE = True
except ImportError:
    RDKIT_AVAILABLE = False


SYSTEM_PROMPT = """You are a chemistry expert. Your ONLY job is to write a
reaction SMILES using the supplied verified molecular catalog. Respond with
ONLY one reaction SMILES line and nothing else.

Format: reactant1.reactant2>>product1.product2
- Use >> to separate reactants from products and . between molecules.
- Copy supplied verified reactant SMILES verbatim; never substitute, simplify,
  or invent a reactant identity.
- If a declared product SMILES is supplied, include it on the product side.
- Do not include catalysts, solvents, workup materials, or spectator species.
- Do not claim a representative molecule for a polymer or other material whose
  reference status is indefinite."""


_REACTANT_ROLES = {
    "reagent", "reactant", "substrate", "starting material", "starting_material",
    "coupling reagent", "oxidant", "reductant", "reducing agent", "oxidizing agent",
    "base", "acid", "activating agent", "deprotecting agent",
}
_PRODUCT_ROLES = {"product", "desired product", "target", "final product"}


def _role_kind(role: object) -> str:
    """Classify only the parsed role; names and fixture content are irrelevant."""
    normalized = str(role or "unknown").casefold().strip()
    if normalized in _PRODUCT_ROLES:
        return "product"
    if normalized in _REACTANT_ROLES:
        return "reactant"
    return "other"


def _verified_smiles(chemical: dict[str, Any]) -> str | None:
    """Return only a structure explicitly supplied as a usable reference."""
    status = chemical.get("reference_status")
    if status is not None and str(status).casefold().strip() not in {"available", "verified"}:
        return None
    smiles = chemical.get("reference_smiles")
    if not isinstance(smiles, str) or not smiles.strip():
        return None
    return smiles.strip()


def build_reaction_catalog(
    chemicals: list[dict[str, Any]] | None,
) -> tuple[list[dict[str, str]], list[dict[str, str]], list[str]]:
    """Build role-derived verified reactant/product catalogs.

    Missing structures for declared molecular participants make inference
    unavailable rather than inviting a model to invent a replacement.
    """
    reactants: list[dict[str, str]] = []
    products: list[dict[str, str]] = []
    unresolved: list[str] = []

    for chemical in chemicals or []:
        kind = _role_kind(chemical.get("role"))
        if kind == "other":
            continue
        name = str(chemical.get("name") or "unknown")
        smiles = _verified_smiles(chemical)
        if not smiles:
            unresolved.append(name)
            continue
        entry = {"name": name, "smiles": smiles}
        if kind == "reactant":
            reactants.append(entry)
        else:
            products.append(entry)
    return reactants, products, unresolved


def _canonical_smiles(smiles: str) -> str | None:
    if not RDKIT_AVAILABLE:
        return None
    try:
        molecule = Chem.MolFromSmiles(smiles)
        return Chem.MolToSmiles(molecule, isomericSmiles=True) if molecule is not None else None
    except Exception:
        return None


def validate_reaction_smiles(
    reaction_smiles: str,
    known_reactants: list[dict[str, str]] | None = None,
    declared_products: list[dict[str, str]] | None = None,
) -> tuple[bool, str, int | None]:
    """Validate parseability and exact verified reactant/product identity.

    ``True`` means parseable and catalog-consistent, not chemically proven or
    atom-balanced.  The returned product index selects the declared product for
    downstream atom-economy calculation.
    """
    if not RDKIT_AVAILABLE:
        return False, "RDKit not available", None
    if not isinstance(reaction_smiles, str) or ">>" not in reaction_smiles:
        return False, "Missing >> separator", None

    parts = reaction_smiles.split(">>")
    if len(parts) != 2:
        return False, "Invalid format", None
    reactant_smiles = [value.strip() for value in parts[0].split(".") if value.strip()]
    product_smiles = [value.strip() for value in parts[1].split(".") if value.strip()]
    if not reactant_smiles or not product_smiles:
        return False, "Missing reactants or products", None

    canonical_reactants: list[str] = []
    for value in reactant_smiles:
        canonical = _canonical_smiles(value)
        if canonical is None:
            return False, f"Invalid reactant SMILES: {value}", None
        canonical_reactants.append(canonical)

    canonical_products: list[str] = []
    for value in product_smiles:
        canonical = _canonical_smiles(value)
        if canonical is None:
            return False, f"Invalid product SMILES: {value}", None
        canonical_products.append(canonical)

    catalog_reactants: list[str] = []
    for known in known_reactants or []:
        canonical = _canonical_smiles(known["smiles"])
        if canonical is None:
            return False, f"Invalid verified reactant SMILES for {known['name']}", None
        if canonical not in canonical_reactants:
            return False, f"Known reactant identity missing or substituted: {known['name']}", None
        catalog_reactants.append(canonical)

    # A molecular catalog bounds permitted identities, not stoichiometric
    # coefficients. Repeated additions of a material are separate occurrences.
    if known_reactants is not None and set(canonical_reactants) != set(catalog_reactants):
        return False, "Reactant identity outside the verified catalog", None

    desired_product_index: int | None = None
    for declared in declared_products or []:
        canonical = _canonical_smiles(declared["smiles"])
        if canonical is None:
            return False, f"Invalid declared product SMILES for {declared['name']}", None
        if canonical not in canonical_products:
            return False, f"Declared product identity missing or distinct: {declared['name']}", None
        if desired_product_index is None:
            desired_product_index = canonical_products.index(canonical)

    return True, "parseable and verified identities match", desired_product_index


def _validate_smiles(reaction_smiles: str) -> tuple[bool, str]:
    """Legacy parseability helper retained for callers outside the score path."""
    valid, reason, _ = validate_reaction_smiles(reaction_smiles)
    return valid, reason


def _extract_smiles_from_response(text: str) -> str | None:
    """Extract a reaction SMILES line from a non-compliant model response."""
    text = text.strip()
    if ">>" in text and "\n" not in text:
        return text
    for line in text.split("\n"):
        line = line.strip()
        if ">>" not in line:
            continue
        line = line.strip("`").strip()
        if ":" in line:
            line = line.split(":", 1)[1].strip()
        return line
    return None


def _catalog_prompt(reactants: list[dict[str, str]], products: list[dict[str, str]]) -> str:
    reactant_lines = "\n".join(f"  - {item['name']}: {item['smiles']}" for item in reactants)
    product_lines = "\n".join(f"  - {item['name']}: {item['smiles']}" for item in products)
    product_section = product_lines or "  - No verified declared product supplied"
    return (
        "Verified reactant catalog (every entry must appear unchanged on the left):\n"
        f"{reactant_lines}\n\n"
        "Declared product catalog (include every supplied identity on the right):\n"
        f"{product_section}"
    )


async def extract_reaction_smiles(
    protocol_text: str,
    chemicals: list[dict[str, Any]] | None = None,
    max_retries: int = 2,
) -> tuple[str | None, dict]:
    """Infer a catalog-constrained reaction SMILES, or report it unavailable."""
    metadata: dict[str, Any] = {
        "attempts": 0,
        "llm_called": False,
        "inferred": False,
        "validated": False,
        "identity_validation": "not_attempted",
        "validation_errors": [],
    }
    known_reactants, declared_products, unresolved = build_reaction_catalog(chemicals)
    metadata["known_reactants"] = [item["name"] for item in known_reactants]
    metadata["declared_products"] = [item["name"] for item in declared_products]

    if unresolved:
        metadata["identity_validation"] = "unavailable"
        metadata["validation_errors"].append(
            "Verified molecular reactants/products unavailable for declared participants: "
            + ", ".join(unresolved)
        )
        return None, metadata
    if not known_reactants:
        metadata["identity_validation"] = "unavailable"
        metadata["validation_errors"].append(
            "No verified molecular reactants supplied; inferred reaction is unavailable."
        )
        return None, metadata

    catalog = _catalog_prompt(known_reactants, declared_products)
    base_prompt = (
        "Write a reaction SMILES using only the verified identity catalog.\n\n"
        f"Protocol:\n{protocol_text[:3000]}\n\n{catalog}\n\n"
        "Reply with ONLY the reaction SMILES string."
    )

    for attempt in range(max_retries):
        metadata["attempts"] = attempt + 1
        metadata["llm_called"] = True
        metadata["inferred"] = True
        prompt = base_prompt
        if attempt:
            prompt = (
                f"Your previous reaction SMILES was rejected: {metadata['validation_errors'][-1]}\n\n"
                f"Try again. {base_prompt}"
            )

        response = await call_llm(prompt, system=SYSTEM_PROMPT)
        if not response:
            metadata["validation_errors"].append("LLM returned no response")
            continue
        candidate = _extract_smiles_from_response(response)
        if not candidate:
            metadata["validation_errors"].append(
                f"Could not extract SMILES from response: {response[:200]}"
            )
            continue

        valid, reason, product_index = validate_reaction_smiles(
            candidate,
            known_reactants=known_reactants,
            declared_products=declared_products,
        )
        if valid:
            metadata.update({
                "validated": True,
                "identity_validation": "parseable_and_identity_consistent" if declared_products else "reactants_verified_product_inferred",
                "product_provenance": "declared" if declared_products else "model-inferred",
                "desired_product_index": product_index,
                "raw_response": response[:500],
            })
            return candidate, metadata
        metadata["identity_validation"] = "failed"
        metadata["validation_errors"].append(f"{reason} (got: {candidate})")

    return None, metadata
