"""Shared models for scoring modules."""

from enum import Enum
from pydantic import BaseModel, Field, field_validator


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


class ScoreProvenance(str, Enum):
    """Canonical provenance taxonomy for all scores and metrics.
    
    See docs/SCORING_PROVENANCE_TAXONOMY.md for complete definitions.
    """
    DECLARED = "declared"           # From protocol text
    CALCULATED = "calculated"       # Deterministic formulas from chemical databases
    BENCHMARK = "benchmark"         # Industry-average estimates (ACS GCI benchmarks)
    MODEL_INFERRED = "model-inferred"  # AI assessment (requires expert review)
    UNAVAILABLE = "unavailable"     # Missing data, cannot score


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
    confidence: ScoreProvenance = ScoreProvenance.CALCULATED
    
    @field_validator('confidence')
    @classmethod
    def validate_confidence(cls, v: ScoreProvenance) -> ScoreProvenance:
        """Ensure confidence is a valid ScoreProvenance value."""
        if isinstance(v, str):
            # Handle legacy string values during migration
            mapping = {
                'calculated': ScoreProvenance.CALCULATED,
                'estimated': ScoreProvenance.MODEL_INFERRED,
                'partial': ScoreProvenance.BENCHMARK,  # Fold partial into benchmark
                'benchmark': ScoreProvenance.BENCHMARK,
                'unavailable': ScoreProvenance.UNAVAILABLE,
                'declared': ScoreProvenance.DECLARED,
            }
            return mapping.get(v.lower(), ScoreProvenance.CALCULATED)
        return v
    
    @field_validator('score')
    @classmethod
    def validate_unavailable_score(cls, v: float, info) -> float:
        """Ensure unavailable confidence pairs with score -1."""
        confidence = info.data.get('confidence')
        if confidence == ScoreProvenance.UNAVAILABLE and v != -1:
            raise ValueError('Unavailable scores must have score = -1')
        return v


class ScoringRequest(BaseModel):
    """Request to score a protocol's chemicals."""
    chemicals: list[ChemicalInput]
    protocol_title: str = ""
    protocol_text: str = ""
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
    total_score: float = 0.0
    max_possible: float = 0.0
    grade: str = "C"
    waste_analysis: dict | None = None
    sds_references: dict[str, list[SdsReference]] | None = None
    smiles_extraction: dict = Field(default_factory=dict)
    yield_extraction: dict = Field(default_factory=dict)
