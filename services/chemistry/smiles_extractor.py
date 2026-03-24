"""Surgical LLM call to extract reaction SMILES from protocol data.

This is a focused, single-purpose prompt — not a full analysis.
The LLM writes the balanced reaction SMILES, and RDKit validates it.
If validation fails, we return None rather than bad data.
"""

import re
from llm_client import call_llm

try:
    from rdkit import Chem
    from rdkit.Chem import Descriptors
    RDKIT_AVAILABLE = True
except ImportError:
    RDKIT_AVAILABLE = False

SYSTEM_PROMPT = """You are a chemistry expert. Your ONLY job is to write 
a balanced reaction SMILES string. Respond with ONLY the reaction SMILES
on a single line, nothing else. No explanation, no commentary.

Format: reactant1.reactant2>>product1.product2
- Use >> to separate reactants from products
- Use . to separate multiple molecules on each side
- Use valid canonical SMILES notation
- Include ALL reactants and ALL products (including byproducts)
- Do NOT include catalysts, solvents, or spectator species
- The reaction MUST be atom-balanced"""


def _validate_smiles(reaction_smiles: str) -> tuple[bool, str]:
    """Validate a reaction SMILES string with RDKit."""
    if not RDKIT_AVAILABLE:
        return False, "RDKit not available"
    
    if ">>" not in reaction_smiles:
        return False, "Missing >> separator"

    parts = reaction_smiles.split(">>")
    if len(parts) != 2:
        return False, "Invalid format"

    reactant_smiles = [s.strip() for s in parts[0].split(".") if s.strip()]
    product_smiles = [s.strip() for s in parts[1].split(".") if s.strip()]

    if not reactant_smiles or not product_smiles:
        return False, "Missing reactants or products"

    # Validate each molecule parses
    for s in reactant_smiles:
        if Chem.MolFromSmiles(s) is None:
            return False, f"Invalid reactant SMILES: {s}"

    for s in product_smiles:
        if Chem.MolFromSmiles(s) is None:
            return False, f"Invalid product SMILES: {s}"

    return True, "valid"


def _extract_smiles_from_response(text: str) -> str | None:
    """Extract reaction SMILES from LLM response text.
    
    Handles cases where the LLM includes extra text despite instructions.
    """
    text = text.strip()

    # Try the whole thing first (ideal case: LLM followed instructions)
    if ">>" in text and "\n" not in text:
        return text

    # Look for a line containing >>
    for line in text.split("\n"):
        line = line.strip()
        if ">>" in line:
            # Strip markdown code fences
            line = line.strip("`").strip()
            # Strip any leading label like "SMILES: "
            if ":" in line:
                line = line.split(":", 1)[1].strip()
            return line

    return None


async def extract_reaction_smiles(
    protocol_text: str,
    chemicals: list[dict] | None = None,
    max_retries: int = 2,
) -> tuple[str | None, dict]:
    """Extract and validate reaction SMILES from protocol text.
    
    Calls the LLM with a focused prompt, validates with RDKit.
    Retries once with error feedback if first attempt fails validation.
    
    Returns:
        (reaction_smiles, metadata_dict)
        smiles is None if extraction fails after retries.
    """
    metadata = {
        "attempts": 0,
        "llm_called": False,
        "validation_errors": [],
    }

    # Build the user prompt
    chem_context = ""
    if chemicals:
        chem_lines = []
        for c in chemicals:
            role = c.get("role", "unknown")
            name = c.get("name", "unknown")
            qty = c.get("quantity", "")
            chem_lines.append(f"  - {name} ({role}) {qty}")
        chem_context = "\nParsed chemicals:\n" + "\n".join(chem_lines)

    base_prompt = (
        f"Write the balanced reaction SMILES for this protocol.\n\n"
        f"Protocol:\n{protocol_text[:3000]}\n"
        f"{chem_context}\n\n"
        f"Reply with ONLY the reaction SMILES string. Nothing else."
    )

    for attempt in range(max_retries):
        metadata["attempts"] = attempt + 1
        metadata["llm_called"] = True

        if attempt == 0:
            prompt = base_prompt
        else:
            # Retry with error feedback
            last_error = metadata["validation_errors"][-1]
            prompt = (
                f"Your previous reaction SMILES was invalid: {last_error}\n\n"
                f"Try again. {base_prompt}"
            )

        response = await call_llm(prompt, system=SYSTEM_PROMPT)
        if not response:
            metadata["validation_errors"].append("LLM returned no response")
            continue

        smiles = _extract_smiles_from_response(response)
        if not smiles:
            metadata["validation_errors"].append(
                f"Could not extract SMILES from response: {response[:200]}"
            )
            continue

        valid, msg = _validate_smiles(smiles)
        if valid:
            metadata["validated"] = True
            metadata["raw_response"] = response[:500]
            return smiles, metadata
        else:
            metadata["validation_errors"].append(f"{msg} (got: {smiles})")

    metadata["validated"] = False
    return None, metadata
