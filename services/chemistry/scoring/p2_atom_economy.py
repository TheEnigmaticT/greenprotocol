"""P2: Atom Economy

Deterministic scoring from reaction SMILES using RDKit.
Atom Economy = (MW of desired product / sum MW of all reactants) × 100%

The reaction SMILES comes from the LLM (Phase 1), but the math
is fully deterministic via RDKit molecular weight calculations.
We validate the reaction by checking atom conservation.

Score: 0 (100% atom economy) to 10 (0% atom economy)
"""

from scoring.models import PrincipleScore

try:
    from rdkit import Chem
    from rdkit.Chem import Descriptors
    RDKIT_AVAILABLE = True
except ImportError:
    RDKIT_AVAILABLE = False

from collections import Counter


def _get_atom_counts(mol) -> Counter:
    """Count atoms in an RDKit molecule."""
    counts: Counter = Counter()
    for atom in mol.GetAtoms():
        counts[atom.GetSymbol()] += 1
    # Add implicit hydrogens
    mol_h = Chem.AddHs(mol)
    counts_h: Counter = Counter()
    for atom in mol_h.GetAtoms():
        counts_h[atom.GetSymbol()] += 1
    return counts_h


def _validate_reaction(
    reactant_mols: list, product_mols: list
) -> tuple[bool, str]:
    """Check if a reaction conserves atoms (is balanced)."""
    reactant_atoms: Counter = Counter()
    for mol in reactant_mols:
        reactant_atoms += _get_atom_counts(mol)

    product_atoms: Counter = Counter()
    for mol in product_mols:
        product_atoms += _get_atom_counts(mol)

    if reactant_atoms == product_atoms:
        return True, "balanced"

    # Find the difference
    diff = {}
    all_elements = set(reactant_atoms.keys()) | set(product_atoms.keys())
    for elem in sorted(all_elements):
        r = reactant_atoms.get(elem, 0)
        p = product_atoms.get(elem, 0)
        if r != p:
            diff[elem] = {"reactants": r, "products": p}

    return False, f"unbalanced: {diff}"


def score_p2(
    reaction_smiles: str | None = None,
    desired_product_index: int = 0,
) -> PrincipleScore:
    """Score Principle 2: Atom Economy.
    
    Args:
        reaction_smiles: Reaction SMILES (reactants>>products)
                        e.g. "A.B>>C.D" where . separates molecules
        desired_product_index: Which product is the desired one (0-indexed)
    """
    if not RDKIT_AVAILABLE:
        return PrincipleScore(
            principle_number=2,
            principle_name="Atom Economy",
            score=-1.0, normalized=-1.0,
            details={"error": "RDKit not available — cannot calculate atom economy"},
            confidence="unavailable",
            data_sources=[],
        )

    if not reaction_smiles or ">>" not in reaction_smiles:
        return PrincipleScore(
            principle_number=2,
            principle_name="Atom Economy",
            score=-1.0, normalized=-1.0,
            details={"error": "No reaction SMILES provided — "
                     "atom economy requires a balanced reaction equation. "
                     "Retry LLM Phase 1 with reaction SMILES extraction."},
            confidence="unavailable",
            data_sources=[],
        )

    # Parse reaction SMILES
    parts = reaction_smiles.split(">>")
    if len(parts) != 2:
        return PrincipleScore(
            principle_number=2, principle_name="Atom Economy",
            score=5.0, normalized=0.5,
            details={"error": f"Invalid reaction SMILES format: {reaction_smiles}"},
            confidence="estimated", data_sources=[],
        )

    reactant_smiles = [s.strip() for s in parts[0].split(".") if s.strip()]
    product_smiles = [s.strip() for s in parts[1].split(".") if s.strip()]

    # Parse molecules
    reactant_mols = []
    for s in reactant_smiles:
        mol = Chem.MolFromSmiles(s)
        if mol is None:
            return PrincipleScore(
                principle_number=2, principle_name="Atom Economy",
                score=-1.0, normalized=-1.0,
                details={"error": f"Invalid reactant SMILES: {s} — "
                         "retry LLM with corrected reaction SMILES"},
                confidence="unavailable", data_sources=["rdkit"],
            )
        reactant_mols.append(mol)

    product_mols = []
    for s in product_smiles:
        mol = Chem.MolFromSmiles(s)
        if mol is None:
            return PrincipleScore(
                principle_number=2, principle_name="Atom Economy",
                score=-1.0, normalized=-1.0,
                details={"error": f"Invalid product SMILES: {s} — "
                         "retry LLM with corrected reaction SMILES"},
                confidence="unavailable", data_sources=["rdkit"],
            )
        product_mols.append(mol)

    # Validate atom conservation
    balanced, balance_msg = _validate_reaction(reactant_mols, product_mols)
    warnings = []
    if not balanced:
        warnings.append(f"Reaction may be unbalanced: {balance_msg}")

    # Calculate molecular weights
    reactant_data = []
    total_reactant_mw = 0.0
    for s, mol in zip(reactant_smiles, reactant_mols):
        mw = Descriptors.MolWt(mol)
        total_reactant_mw += mw
        reactant_data.append({"smiles": s, "mw": round(mw, 4)})

    product_data = []
    for s, mol in zip(product_smiles, product_mols):
        mw = Descriptors.MolWt(mol)
        product_data.append({"smiles": s, "mw": round(mw, 4)})

    # Get desired product
    if desired_product_index >= len(product_mols):
        desired_product_index = 0

    desired_mw = Descriptors.MolWt(product_mols[desired_product_index])
    byproduct_mw = sum(
        Descriptors.MolWt(m) for i, m in enumerate(product_mols)
        if i != desired_product_index
    )

    # Atom economy calculation
    atom_economy_pct = (desired_mw / total_reactant_mw * 100) if total_reactant_mw > 0 else 0

    # Score: 100% AE = 0/10, 0% AE = 10/10
    score = round(10.0 * (1.0 - atom_economy_pct / 100.0), 2)
    score = max(0.0, min(10.0, score))

    confidence = "calculated" if balanced else "partial"

    return PrincipleScore(
        principle_number=2,
        principle_name="Atom Economy",
        score=score,
        normalized=round(score / 10.0, 4),
        details={
            "reaction_smiles": reaction_smiles,
            "atom_economy_pct": round(atom_economy_pct, 2),
            "desired_product_mw": round(desired_mw, 4),
            "total_reactant_mw": round(total_reactant_mw, 4),
            "byproduct_mw": round(byproduct_mw, 4),
            "reactants": reactant_data,
            "products": product_data,
            "balanced": balanced,
            "balance_detail": balance_msg,
            "warnings": warnings,
        },
        data_sources=["rdkit"],
        confidence=confidence,
    )
