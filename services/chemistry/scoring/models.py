"""Shared models for scoring modules."""

from pydantic import BaseModel, Field


class ChemicalInput(BaseModel):
    """A chemical from the LLM's Phase 1 parse output."""
    name: str
    role: str = "unknown"  # solvent, reagent, catalyst, product, etc.
    quantity: str = ""     # raw quantity string, e.g. "5 mL"
    quantity_g: float | None = None   # from unit converter
    quantity_kg: float | None = None
    quantity_mol: float | None = None
    molecular_weight: float | None = None
    step_number: int = 0


class PrincipleScore(BaseModel):
    """Score for a single green chemistry principle."""
    principle_number: int
    principle_name: str
    score: float = Field(..., ge=-1, le=10, description="0=best, 10=worst, -1=unavailable")
    max_score: float = 10.0
    normalized: float = Field(0.0, ge=-1, le=1, description="0=best, 1=worst, -1=unavailable")
    details: dict = Field(default_factory=dict)
    chemicals_flagged: list[str] = Field(default_factory=list)
    data_sources: list[str] = Field(default_factory=list)
    confidence: str = "calculated"  # calculated, estimated, partial


class ScoringRequest(BaseModel):
    """Request to score a protocol's chemicals."""
    chemicals: list[ChemicalInput]
    protocol_title: str = ""
    step_number: int | None = None
    reaction_smiles: str | None = None
    steps: list[dict] = Field(default_factory=list)


class SdsReference(BaseModel):
    """Optional SDS reference for a chemical. SDS is evidence, not a scoring source."""
    supplier: str = ""
    product_number: str | None = None
    url: str | None = None
    retrieved_at: str | None = None


class ScoringResponse(BaseModel):
    """Response with principle scores and optional waste analysis."""
    scores: list[PrincipleScore]
    summary: str = ""
    waste_analysis: dict | None = None
    # Placeholder: SDS references per chemical, keyed by name
    sds_references: dict[str, list[SdsReference]] | None = None
