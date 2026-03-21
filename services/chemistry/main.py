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
from scoring.p5_safer_solvents import score_p5
from scoring.p3_less_hazardous import score_p3
from scoring.p6_energy_efficiency import score_p6
from scoring.p10_degradation import score_p10
from scoring.p12_accident_prevention import score_p12
from ghs import lookup_hcodes
from pubchem import lookup_properties
from pydantic import BaseModel, Field


class ScoreAllRequest(BaseModel):
    chemicals: list[ChemicalInput]
    steps: list[dict] = Field(default_factory=list)


class ScoreAllResponse(BaseModel):
    scores: list[PrincipleScore]
    total_score: float = 0.0
    max_possible: float = 50.0
    grade: str = ""


@app.post("/score", response_model=ScoreAllResponse)
async def score_protocol(req: ScoreAllRequest):
    """Score a protocol against all deterministic principles (P3, P5, P6, P10, P12).
    
    Requires chemicals with resolved quantities (call /batch first).
    """
    # Build H-code map for all chemicals via PubChem
    hcodes_map: dict[str, list[str]] = {}
    for chem in req.chemicals:
        props = await lookup_properties(chem.name)
        if props and props.get("cid"):
            codes = await lookup_hcodes(props["cid"])
            hcodes_map[chem.name] = codes

    # Run all scorers
    scores = [
        score_p3(req.chemicals, hcodes_map),
        score_p5(req.chemicals),
        score_p6(req.steps),
        score_p10(req.chemicals, hcodes_map),
        score_p12(req.chemicals, hcodes_map),
    ]

    total = sum(s.score for s in scores)
    max_possible = 50.0

    # Grade: A (0-10), B (10-20), C (20-30), D (30-40), F (40-50)
    if total <= 10:
        grade = "A"
    elif total <= 20:
        grade = "B"
    elif total <= 30:
        grade = "C"
    elif total <= 40:
        grade = "D"
    else:
        grade = "F"

    return ScoreAllResponse(
        scores=scores,
        total_score=round(total, 2),
        max_possible=max_possible,
        grade=grade,
    )
