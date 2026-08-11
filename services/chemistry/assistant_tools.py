"""Read-only chemistry lookups for the scoped scientific chat."""

from __future__ import annotations

import math
from dataclasses import asdict
from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, model_validator

from chem21 import lookup_solvent_with_evidence
from ghs import lookup_hcodes
from pubchem import lookup_chemical
from solvent_evidence_store import SolventEvidenceUnavailableError, get_store
from solvent_screening import _valid_identity, normalize_smiles, screen_candidates

try:
    from rdkit import Chem
    from rdkit.Chem import Descriptors
    RDKIT_AVAILABLE = True
except ImportError:
    RDKIT_AVAILABLE = False


class AssistantToolRequest(BaseModel):
    """Validated request envelope for the closed set of assistant operations."""

    model_config = ConfigDict(allow_inf_nan=False)

    operation: Literal[
        "chem21", "pubchem", "rdkit", "solvent_evidence", "solvent_hazard", "solvent_screening"
    ]
    chemical_name: str | None = Field(default=None, min_length=1, max_length=200)
    mode: Literal["single_solubility", "mixture_solubility", "density"] | None = None
    solute_smiles: str | None = Field(default=None, min_length=1, max_length=2_000)
    solvent: str | None = Field(default=None, min_length=1, max_length=200)
    co_solvent: str | None = Field(default=None, min_length=1, max_length=200)
    fraction_solvent: float | None = None
    fraction_type: str | None = Field(default=None, min_length=1, max_length=100)
    temperature_k: float | None = None
    current_solvent: str | None = Field(default=None, min_length=1, max_length=200)

    @model_validator(mode="after")
    def _require_operation_fields(self) -> "AssistantToolRequest":
        if self.operation in {"chem21", "pubchem", "rdkit"}:
            if self.chemical_name is None:
                raise ValueError("chemical_name is required for this operation")
        elif self.operation == "solvent_evidence":
            if self.mode is None:
                raise ValueError("mode is required for solvent_evidence")
            if self.mode == "single_solubility" and not all(
                (self.solute_smiles, self.solvent, self.temperature_k is not None)
            ):
                raise ValueError("single_solubility requires solute_smiles, solvent, and temperature_k")
            if self.mode == "mixture_solubility" and not all(
                (
                    self.solute_smiles,
                    self.solvent,
                    self.co_solvent,
                    self.fraction_solvent is not None,
                    self.fraction_type,
                    self.temperature_k is not None,
                )
            ):
                raise ValueError(
                    "mixture_solubility requires solute_smiles, solvent, co_solvent, "
                    "fraction_solvent, fraction_type, and temperature_k"
                )
            if self.mode == "density" and not all((self.solvent, self.temperature_k is not None)):
                raise ValueError("density requires solvent and temperature_k")
        elif self.operation == "solvent_hazard":
            if self.solvent is None:
                raise ValueError("solvent is required for solvent_hazard")
        elif self.operation == "solvent_screening" and not all(
            (self.solute_smiles, self.current_solvent, self.temperature_k is not None)
        ):
            raise ValueError("solvent_screening requires solute_smiles, current_solvent, and temperature_k")
        return self


class SolventEvidenceRequest(AssistantToolRequest):
    operation: Literal["solvent_evidence"]


class SolventHazardRequest(AssistantToolRequest):
    operation: Literal["solvent_hazard"]


class SolventScreeningRequest(AssistantToolRequest):
    operation: Literal["solvent_screening"]


class Chem21ToolRequest(AssistantToolRequest):
    operation: Literal["chem21"]
    chemical_name: str = Field(..., min_length=1, max_length=200)


class PubChemToolRequest(AssistantToolRequest):
    operation: Literal["pubchem"]
    chemical_name: str = Field(..., min_length=1, max_length=200)


class RdkitToolRequest(AssistantToolRequest):
    operation: Literal["rdkit"]
    chemical_name: str = Field(..., min_length=1, max_length=200)


class TypedSolventEvidenceRequest(SolventEvidenceRequest):
    mode: Literal["single_solubility", "mixture_solubility", "density"]


class TypedSolventHazardRequest(SolventHazardRequest):
    solvent: str = Field(..., min_length=1, max_length=200)


class TypedSolventScreeningRequest(SolventScreeningRequest):
    solute_smiles: str = Field(..., min_length=1, max_length=2_000)
    current_solvent: str = Field(..., min_length=1, max_length=200)
    temperature_k: float


AssistantToolPayload: TypeAlias = Annotated[
    Chem21ToolRequest
    | PubChemToolRequest
    | RdkitToolRequest
    | TypedSolventEvidenceRequest
    | TypedSolventHazardRequest
    | TypedSolventScreeningRequest,
    Field(discriminator="operation"),
]


class AssistantToolResponse(BaseModel):
    operation: Literal[
        "chem21", "pubchem", "rdkit", "solvent_evidence", "solvent_hazard", "solvent_screening"
    ]
    chemical_name: str
    status: Literal["ok", "not_found", "unavailable"]
    source: str
    data: dict = Field(default_factory=dict)
    citations: list[dict | str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


async def execute_assistant_tool(request: AssistantToolRequest) -> AssistantToolResponse:
    """Execute one read-only operation, keeping local operations network-free."""
    if request.operation == "solvent_evidence":
        return _execute_local_evidence(request)
    if request.operation == "solvent_hazard":
        return _execute_local_hazard(request)
    if request.operation == "solvent_screening":
        return _execute_local_screening(request)

    if request.operation == "chem21":
        try:
            assessment = lookup_solvent_with_evidence(request.chemical_name or "")
        except SolventEvidenceUnavailableError as error:
            return AssistantToolResponse(
                operation="chem21",
                chemical_name=request.chemical_name or "",
                status="unavailable",
                source="CHEM21",
                warnings=[f"CHEM21 data is unavailable: {error}"],
            )
        if assessment is None:
            return AssistantToolResponse(
                operation="chem21",
                chemical_name=request.chemical_name or "",
                status="not_found",
                source="CHEM21",
                warnings=["This chemical is not listed in the local CHEM21 solvent guide."],
            )
        return AssistantToolResponse(
            operation="chem21",
            chemical_name=assessment["name"],
            status="ok",
            source="CHEM21",
            data={"classification": assessment["classification"], "scores": assessment["scores"]},
            citations=[assessment["evidence"]],
        )

    chemical = await lookup_chemical(request.chemical_name or "")
    if chemical is None:
        return AssistantToolResponse(
            operation=request.operation,
            chemical_name=request.chemical_name or "",
            status="not_found",
            source="PubChem",
            warnings=["The chemical could not be resolved by PubChem or the local fallback."],
        )

    source = "Local fallback" if chemical.get("_data_source") == "local_fallback" else "PubChem"
    if request.operation == "pubchem":
        hcodes = await lookup_hcodes(chemical["cid"]) if chemical.get("cid") else []
        return AssistantToolResponse(
            operation="pubchem",
            chemical_name=request.chemical_name or "",
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
            chemical_name=request.chemical_name or "",
            status="unavailable",
            source="RDKit",
            warnings=["RDKit or a resolvable canonical SMILES is unavailable."],
        )
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        return AssistantToolResponse(
            operation="rdkit",
            chemical_name=request.chemical_name or "",
            status="unavailable",
            source="RDKit",
            warnings=["RDKit could not parse the resolved canonical SMILES."],
        )
    return AssistantToolResponse(
        operation="rdkit",
        chemical_name=request.chemical_name or "",
        status="ok",
        source="RDKit",
        data={"canonical_smiles": smiles, "molecular_weight": round(Descriptors.MolWt(molecule), 3)},
    )


def _execute_local_evidence(request: AssistantToolRequest) -> AssistantToolResponse:
    if not _local_request_is_valid(request):
        return _invalid_local_response(request, "Malformed local evidence identity or temperature.")
    try:
        store = get_store()
        if request.mode == "single_solubility":
            measurements = store.single_solubility(request.solute_smiles or "", request.solvent or "", request.temperature_k)
        elif request.mode == "mixture_solubility":
            measurements = store.mixture_solubility(
                request.solute_smiles or "", request.solvent or "", request.co_solvent or "",
                request.fraction_solvent, request.fraction_type or "",
            )
            measurements = [
                row for row in measurements
                if _same_temperature(row.get("temperature_k"), request.temperature_k)
            ]
        else:
            measurements = store.density(request.solvent or "", request.temperature_k)
    except SolventEvidenceUnavailableError as error:
        return _local_unavailable(request, error)
    return _measurement_response(request, measurements)


def _execute_local_hazard(request: AssistantToolRequest) -> AssistantToolResponse:
    if not _valid_identity(request.solvent):
        return _invalid_local_response(request, "Malformed local hazard identity.")
    try:
        profile = get_store().hazard_profile(request.solvent or "")
    except SolventEvidenceUnavailableError as error:
        return _local_unavailable(request, error)
    if profile is None:
        return AssistantToolResponse(
            operation="solvent_hazard", chemical_name=request.solvent or "", status="not_found", source="Local GHS evidence",
            warnings=["No complete local GHS profile is available for this solvent."],
        )
    return AssistantToolResponse(
        operation="solvent_hazard", chemical_name=profile.solvent, status="ok", source="Local GHS evidence",
        data={"categories": profile.category_levels(), "hcodes": list(profile.hcodes), "retrieved_at": profile.retrieved_at},
        citations=[{"source": profile.source_url, "snapshot": profile.snapshot_path, "sha256": profile.snapshot_sha256}],
    )


def _execute_local_screening(request: AssistantToolRequest) -> AssistantToolResponse:
    if not _local_request_is_valid(request, screening=True):
        return _invalid_local_response(request, "Malformed local screening identity or temperature.")
    try:
        candidates = screen_candidates(
            request.solute_smiles or "", request.current_solvent or "", request.temperature_k
        )
    except SolventEvidenceUnavailableError as error:
        return _local_unavailable(request, error)
    return AssistantToolResponse(
        operation="solvent_screening", chemical_name=request.current_solvent or "", status="ok", source="Local solvent evidence",
        data={"candidates": [asdict(candidate) for candidate in candidates]},
    )


def _measurement_response(request: AssistantToolRequest, measurements: list[dict]) -> AssistantToolResponse:
    capped = measurements[:20]
    return AssistantToolResponse(
        operation="solvent_evidence", chemical_name=request.solvent or "", status="ok" if capped else "not_found",
        source="Local solvent evidence", data={"measurements": capped},
        warnings=["Results were truncated to the first 20 raw measurements."] if len(measurements) > 20 else [],
    )


def _local_request_is_valid(request: AssistantToolRequest, *, screening: bool = False) -> bool:
    temperature = request.temperature_k
    if not _same_temperature(temperature, temperature):
        return False
    if screening:
        return normalize_smiles(request.solute_smiles or "") is not None and _valid_identity(request.current_solvent)
    if request.mode == "density":
        return _valid_identity(request.solvent)
    if request.mode == "mixture_solubility":
        return (
            normalize_smiles(request.solute_smiles or "") is not None
            and _valid_identity(request.solvent)
            and _valid_identity(request.co_solvent)
            and isinstance(request.fraction_solvent, (int, float))
            and math.isfinite(request.fraction_solvent)
            and _valid_identity(request.fraction_type)
        )
    return normalize_smiles(request.solute_smiles or "") is not None and _valid_identity(request.solvent)


def _same_temperature(value: object, requested: object) -> bool:
    return (
        isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        and isinstance(requested, (int, float)) and not isinstance(requested, bool) and math.isfinite(requested)
        and abs(float(value) - float(requested)) <= 0.01
    )


def _invalid_local_response(request: AssistantToolRequest, warning: str) -> AssistantToolResponse:
    return AssistantToolResponse(
        operation=request.operation, chemical_name=request.solvent or request.current_solvent or "", status="not_found",
        source="Local solvent evidence", warnings=[warning],
    )


def _local_unavailable(request: AssistantToolRequest, error: SolventEvidenceUnavailableError) -> AssistantToolResponse:
    return AssistantToolResponse(
        operation=request.operation, chemical_name=request.solvent or request.current_solvent or "", status="unavailable",
        source="Local solvent evidence", warnings=[f"Local solvent evidence is unavailable: {error}"],
    )
