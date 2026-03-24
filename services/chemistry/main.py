"""FastAPI chemistry unit conversion microservice."""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from models import (
    ConvertRequest, ConvertResponse,
    BatchRequest, BatchResponse,
    HealthResponse,
)
from converter import convert, RDKIT_AVAILABLE
import cache


@asynccontextmanager
async def lifespan(app: FastAPI):
    cache.init_cache()
    yield


app = FastAPI(
    title="Green Chemistry Unit Converter",
    description="Deterministic chemical unit conversions using PubChem + RDKit",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        rdkit_available=RDKIT_AVAILABLE,
        cache_size=cache.size(),
    )


@app.post("/convert", response_model=ConvertResponse)
async def convert_single(req: ConvertRequest):
    return await convert(req.chemical_name, req.quantity)


@app.post("/batch", response_model=BatchResponse)
async def convert_batch(req: BatchRequest):
    results = []
    for item in req.chemicals:
        result = await convert(item.chemical_name, item.quantity)
        results.append(result)
    return BatchResponse(results=results)


# --- Scoring endpoints ---

from scoring.models import ScoringRequest, ScoringResponse, ChemicalInput, PrincipleScore
from scoring.p1_waste_prevention import score_p1
from scoring.p2_atom_economy import score_p2
from scoring.p3_less_hazardous import score_p3
from scoring.p4_product_toxicity import score_p4
from scoring.p5_safer_solvents import score_p5
from scoring.p6_energy_efficiency import score_p6
from scoring.p7_renewable_feedstocks import score_p7
from scoring.p8_reduce_derivatives import score_p8
from scoring.p9_catalysis import score_p9
from scoring.p10_degradation import score_p10
from scoring.p11_realtime_analysis import score_p11
from scoring.p12_accident_prevention import score_p12
from ghs import lookup_hcodes
from pubchem import lookup_properties
from smiles_extractor import extract_reaction_smiles
from yield_extractor import extract_yield_and_type
from pydantic import BaseModel, Field


class ScoreAllRequest(BaseModel):
    chemicals: list[ChemicalInput]
    steps: list[dict] = Field(default_factory=list)
    reaction_smiles: str | None = Field(None, description="Balanced reaction SMILES (reactants>>products)")
    desired_product_index: int = Field(0, description="Index of the desired product in the reaction SMILES")
    protocol_text: str = Field("", description="Original protocol text (used for SMILES extraction if reaction_smiles not provided)")


class ScoreAllResponse(BaseModel):
    scores: list[PrincipleScore]
    total_score: float = 0.0
    max_possible: float = 50.0
    grade: str = ""
    smiles_extraction: dict = Field(default_factory=dict, description="Metadata from auto SMILES extraction (if triggered)")
    yield_extraction: dict = Field(default_factory=dict, description="Metadata from yield/reaction type extraction (if triggered)")


@app.post("/score", response_model=ScoreAllResponse)
async def score_protocol(req: ScoreAllRequest):
    """Score a protocol against all deterministic principles (P3, P5, P6, P10, P12).
    
    Requires chemicals with resolved quantities (call /batch first).
    """
    # Auto-extract reaction SMILES if not provided and protocol text is available
    reaction_smiles = req.reaction_smiles
    smiles_metadata: dict = {}
    if not reaction_smiles and req.protocol_text:
        chem_dicts = [{"name": c.name, "role": c.role, "quantity": c.quantity if hasattr(c, 'quantity') else ""}
                      for c in req.chemicals]
        reaction_smiles, smiles_metadata = await extract_reaction_smiles(
            req.protocol_text, chem_dicts
        )

    # Build H-code map for all chemicals via PubChem
    hcodes_map: dict[str, list[str]] = {}
    for chem in req.chemicals:
        props = await lookup_properties(chem.name)
        if props and props.get("cid"):
            codes = await lookup_hcodes(props["cid"])
            hcodes_map[chem.name] = codes

    # Extract yield + reaction type (surgical LLM call if protocol_text provided)
    yield_data: dict = {}
    if req.protocol_text:
        chem_dicts = [{"name": c.name, "role": c.role} for c in req.chemicals]
        yield_data = await extract_yield_and_type(req.protocol_text, chem_dicts)

    # Get P2 result first — we need atom economy for P1
    p2_result = score_p2(reaction_smiles, req.desired_product_index)
    atom_economy_pct = (
        p2_result.details.get("atom_economy_pct")
        if p2_result.score >= 0 else None
    )

    # Build P1 inputs from yield extraction + P2 atom economy
    benchmark = yield_data.get("benchmark", {})
    p1_result = score_p1(
        chemicals=req.chemicals,
        yield_pct=yield_data.get("yield_pct"),
        yield_source=yield_data.get("confidence", "unknown"),
        reaction_type=yield_data.get("reaction_type"),
        benchmark_efficiency=benchmark.get("typical_efficiency"),
        benchmark_pmi=benchmark.get("typical_pmi"),
        atom_economy_pct=atom_economy_pct,
    )

    # Run all scorers
    scores = [
        p1_result,
        p2_result,
        score_p3(req.chemicals, hcodes_map),
        score_p4(req.chemicals, hcodes_map),
        score_p5(req.chemicals),
        score_p6(req.steps),
        score_p7(req.chemicals),
        await score_p8(req.steps, req.protocol_text),
        score_p9(req.chemicals),
        score_p10(req.chemicals, hcodes_map),
        await score_p11(req.steps, req.protocol_text),
        score_p12(req.chemicals, hcodes_map),
    ]

    # Only count scores that were actually calculated (not -1/unavailable)
    available_scores = [s for s in scores if s.score >= 0]
    unavailable_scores = [s for s in scores if s.score < 0]
    total = sum(s.score for s in available_scores)
    max_possible = len(available_scores) * 10.0

    # Grade on percentage: A (<20%), B (20-40%), C (40-60%), D (60-80%), F (>80%)
    pct = (total / max_possible) * 100 if max_possible > 0 else 0
    if pct <= 20:
        grade = "A"
    elif pct <= 40:
        grade = "B"
    elif pct <= 60:
        grade = "C"
    elif pct <= 80:
        grade = "D"
    else:
        grade = "F"

    return ScoreAllResponse(
        scores=scores,
        total_score=round(total, 2),
        max_possible=max_possible,
        grade=grade,
        smiles_extraction=smiles_metadata,
        yield_extraction=yield_data,
    )
