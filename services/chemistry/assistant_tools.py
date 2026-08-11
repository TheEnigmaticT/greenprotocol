"""Read-only chemistry lookups for the scoped scientific chat."""

from typing import Literal

from pydantic import BaseModel, Field

from ghs import lookup_hcodes
from pubchem import lookup_chemical

try:
    from rdkit import Chem
    from rdkit.Chem import Descriptors
    RDKIT_AVAILABLE = True
except ImportError:
    RDKIT_AVAILABLE = False
from chem21 import lookup_solvent_with_evidence


class AssistantToolRequest(BaseModel):
    operation: Literal["chem21", "pubchem", "rdkit"]
    chemical_name: str = Field(..., min_length=1, max_length=200)


class AssistantToolResponse(BaseModel):
    operation: Literal["chem21", "pubchem", "rdkit"]
    chemical_name: str
    status: Literal["ok", "not_found", "unavailable"]
    source: str
    data: dict = Field(default_factory=dict)
    citations: list[dict] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


async def execute_assistant_tool(request: AssistantToolRequest) -> AssistantToolResponse:
    if request.operation == "chem21":
        assessment = lookup_solvent_with_evidence(request.chemical_name)
        if assessment is None:
            return AssistantToolResponse(
                operation="chem21",
                chemical_name=request.chemical_name,
                status="not_found",
                source="CHEM21",
                warnings=["This chemical is not listed in the local CHEM21 solvent guide."],
            )

        return AssistantToolResponse(
            operation="chem21",
            chemical_name=assessment["name"],
            status="ok",
            source="CHEM21",
            data={
                "classification": assessment["classification"],
                "scores": assessment["scores"],
            },
            citations=[assessment["evidence"]],
        )

    chemical = await lookup_chemical(request.chemical_name)
    if chemical is None:
        return AssistantToolResponse(
            operation=request.operation,
            chemical_name=request.chemical_name,
            status="not_found",
            source="PubChem",
            warnings=["The chemical could not be resolved by PubChem or the local fallback."],
        )

    source = "Local fallback" if chemical.get("_data_source") == "local_fallback" else "PubChem"
    if request.operation == "pubchem":
        hcodes = await lookup_hcodes(chemical["cid"]) if chemical.get("cid") else []
        return AssistantToolResponse(
            operation="pubchem",
            chemical_name=request.chemical_name,
            status="ok",
            source=source,
            data={
                "cid": chemical.get("cid"),
                "molecular_formula": chemical.get("molecular_formula"),
                "molecular_weight": chemical.get("molecular_weight"),
                "canonical_smiles": chemical.get("canonical_smiles"),
                "ghs_hazards": [
                    {"code": code, "source": "PubChem GHS Classification" if source == "PubChem" else "Local fallback"}
                    for code in hcodes
                ],
            },
        )

    smiles = chemical.get("canonical_smiles")
    if not RDKIT_AVAILABLE or not smiles:
        return AssistantToolResponse(
            operation="rdkit",
            chemical_name=request.chemical_name,
            status="unavailable",
            source="RDKit",
            warnings=["RDKit or a resolvable canonical SMILES is unavailable."],
        )
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        return AssistantToolResponse(
            operation="rdkit",
            chemical_name=request.chemical_name,
            status="unavailable",
            source="RDKit",
            warnings=["RDKit could not parse the resolved canonical SMILES."],
        )
    return AssistantToolResponse(
        operation="rdkit",
        chemical_name=request.chemical_name,
        status="ok",
        source="RDKit",
        data={
            "canonical_smiles": smiles,
            "molecular_weight": round(Descriptors.MolWt(molecule), 3),
        },
    )
