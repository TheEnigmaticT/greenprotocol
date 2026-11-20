"""Shared models for scoring modules."""

from enum import Enum
from pydantic import BaseModel, Field, field_validator, model_validator


class ChemicalInput(BaseModel):
    """A parsed protocol chemical plus optional per-occurrence reference data.

    ``name`` is always the protocol's requested label.  Reference fields are
    evidence attached to that occurrence; they must not silently replace it.
    """
    name: str
    role: str = "unknown"  # solvent, reagent, catalyst, product, etc.
    process_use: str | None = None  # parent-populated: e.g. workup_solvent
    quantity: str | None = None  # compatibility raw quantity; null stays null
    raw_quantity: str | None = None  # original parser quantity, including null
    quantity_g: float | None = None   # from unit converter
    quantity_kg: float | None = None
    quantity_mol: float | None = None
    molecular_weight: float | None = None
    reference_name: str | None = None  # exact canonical reference identity
    reference_smiles: str | None = None  # verified structure for this occurrence
    reference_status: str | None = None  # available, indefinite, unavailable, etc.
    reference_provenance: str | None = None  # cache, pubchem, supplied, etc.
    reference_hcodes: list[str] | None = None
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


# Legacy provenance labels that predate the canonical taxonomy.  They are
# mapped explicitly; an unknown label is rejected rather than guessed.
LEGACY_CONFIDENCE_ALIASES = {
    "estimated": ScoreProvenance.MODEL_INFERRED,
    "partial": ScoreProvenance.BENCHMARK,
}


def normalize_confidence(value) -> ScoreProvenance:
    """Map a provenance label onto the canonical taxonomy.

    Canonical enum values are preserved verbatim (including
    ``model-inferred``), legacy aliases are mapped explicitly, and anything
    else is rejected — an unknown label is never silently relabelled
    "calculated".
    """
    if isinstance(value, ScoreProvenance):
        return value
    if isinstance(value, str):
        key = value.strip().lower()
        for member in ScoreProvenance:
            if member.value == key:
                return member
        if key in LEGACY_CONFIDENCE_ALIASES:
            return LEGACY_CONFIDENCE_ALIASES[key]
        raise ValueError(f"Unknown confidence provenance: {value!r}")
    raise ValueError(f"Invalid confidence provenance: {value!r}")


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

    @field_validator('confidence', mode='before')
    @classmethod
    def validate_confidence(cls, v) -> ScoreProvenance:
        """Keep canonical provenance strings and reject unknown ones.

        Runs *before* enum coercion so legacy aliases survive, and so an
        unknown label fails loudly instead of being relabelled "calculated".
        """
        return normalize_confidence(v)

    @model_validator(mode='after')
    def validate_unavailable_score(self) -> 'PrincipleScore':
        """Unavailable confidence must pair with score == -1.

        The earlier field_validator was dead because ``score`` is declared
        before ``confidence`` in the model, so ``info.data['confidence']``
        was always unset when score's validator ran. This after-model
        validator runs with both fields populated.
        """
        if self.confidence == ScoreProvenance.UNAVAILABLE and self.score != -1.0:
            raise ValueError('Unavailable scores must have score = -1')
        return self


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


class CoverageMetadata(BaseModel):
    """Truthful coverage metadata for the scoring response.

    assessed = number of principles with a numeric score
    total    = number of principles in the canonical 12-principle set
    unavailable = number of principles that returned score == -1
    partial  = True iff unavailable > 0 (i.e. coverage is incomplete)

    Optional in the wire format so existing consumers keep working.
    """
    assessed: int = 0
    total: int = 12
    unavailable: int = 0
    partial: bool = False


class ScoringResponse(BaseModel):
    """Response with principle scores and optional waste analysis."""
    scores: list[PrincipleScore]
    summary: str = ""
    total_score: float = 0.0
    max_possible: float = 0.0
    grade: str = "C"
    coverage: CoverageMetadata | None = None
    waste_analysis: dict | None = None
    sds_references: dict[str, list[SdsReference]] | None = None
    smiles_extraction: dict = Field(default_factory=dict)
    yield_extraction: dict = Field(default_factory=dict)
