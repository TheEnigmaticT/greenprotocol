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
