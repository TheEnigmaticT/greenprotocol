"""Pydantic models for request/response schemas."""

from pydantic import BaseModel, Field


class ConvertRequest(BaseModel):
    chemical_name: str = Field(..., description="Chemical name or common abbreviation")
    quantity: str = Field(..., description="Quantity string, e.g. '5 mL', '2.3 g', '0.1 mol'")


class ConvertResponse(BaseModel):
    chemical_name: str = Field(..., description="Resolved canonical name")
    cas: str | None = Field(None, description="CAS registry number if available")
    smiles: str | None = Field(None, description="Canonical SMILES")
    molecular_formula: str | None = Field(None)
    molecular_weight: float | None = Field(None, description="g/mol")
    density_g_per_ml: float | None = Field(None)
    input_quantity: str = Field(..., description="Original input string")
    parsed_value: float | None = Field(None)
    parsed_unit: str | None = Field(None)
    quantity_g: float | None = Field(None)
    quantity_kg: float | None = Field(None)
    quantity_mol: float | None = Field(None)
    data_source: str = Field("unknown", description="pubchem, rdkit, cache, or synonym_table")
    cached: bool = False
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None


class BatchRequest(BaseModel):
    chemicals: list[ConvertRequest]


class BatchResponse(BaseModel):
    results: list[ConvertResponse]


class HealthResponse(BaseModel):
    status: str = "ok"
    rdkit_available: bool = False
    cache_size: int = 0
