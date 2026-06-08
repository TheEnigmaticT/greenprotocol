from fastapi import FastAPI, HTTPException
from scoring.models import ScoringRequest, ScoringResponse
from scoring.p1_waste_prevention import score_p1
from scoring.p2_atom_economy import score_p2
from scoring.p3_less_hazardous import score_p3
from scoring.p5_safer_solvents import score_p5
from scoring.p6_energy_efficiency import score_p6
from scoring.p11_realtime_analysis import score_p11
from scoring.p12_accident_prevention import score_p12
from scoring.waste_analysis import compute_waste_analysis
from scoring.process_complexity import analyze_complexity
from ghs import lookup_hcodes
from models import BatchRequest, BatchResponse, ConvertResponse
from converter import convert
from yield_extractor import extract_yield_and_type
import cache as chem_cache
from synonyms import resolve_synonym
import asyncio

app = FastAPI(title="GC.ai Chemistry Service")

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/batch", response_model=BatchResponse)
async def batch_convert(request: BatchRequest):
    """Batch convert chemicals to standardized units."""
    tasks = [convert(c.chemical_name, c.quantity) for c in request.chemicals]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    converted = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            chem = request.chemicals[i]
            converted.append(ConvertResponse(
                chemical_name=chem.chemical_name,
                input_quantity=chem.quantity,
                data_source="error",
                error=str(result),
            ))
        else:
            converted.append(result)
    return BatchResponse(results=converted)


@app.post("/score", response_model=ScoringResponse)
async def score_protocol(request: ScoringRequest):
    """Score a protocol based on Green Chemistry principles."""
    if not request.chemicals:
        raise HTTPException(status_code=400, detail="No chemicals provided")

    # Read GHS H-codes from the converter cache (populated by /batch).
    # Falls back to [] for chemicals not yet converted, so P3 degrades gracefully.
    hcodes_map: dict[str, list[str]] = {}
    for chem in request.chemicals:
        resolved = resolve_synonym(chem.name)
        cached = chem_cache.get(resolved) or chem_cache.get(chem.name)
        if cached and cached.get("ghs_hazards"):
            hcodes_map[chem.name] = [
                h["code"] for h in cached["ghs_hazards"] if "code" in h
            ]
        else:
            hcodes_map[chem.name] = []

    # Extract yield and reaction type for P1 PMI calculation.
    yield_info: dict = {}
    if request.protocol_text:
        try:
            chem_dicts = [
                {"name": c.name, "role": c.role, "quantity": c.quantity}
                for c in request.chemicals
            ]
            yield_info = await extract_yield_and_type(request.protocol_text, chem_dicts)
        except Exception as e:
            print(f"[score] yield extraction failed: {e}")

    # Calculate scores
    p2 = score_p2(reaction_smiles=request.reaction_smiles)
    ae_pct = p2.details.get("atom_economy_pct")
    benchmark = yield_info.get("benchmark", {})

    p1 = score_p1(
        chemicals=request.chemicals,
        atom_economy_pct=ae_pct,
        yield_pct=yield_info.get("yield_pct"),
        yield_source=yield_info.get("confidence", "unknown"),
        reaction_type=yield_info.get("reaction_type"),
        benchmark_efficiency=benchmark.get("typical_efficiency"),
        benchmark_pmi=benchmark.get("typical_pmi"),
    )
    p3 = score_p3(chemicals=request.chemicals, hcodes_map=hcodes_map)
    p5 = score_p5(chemicals=request.chemicals)
    p6 = score_p6(steps=request.steps)
    p11 = await score_p11(steps=request.steps, protocol_text=request.protocol_text)
    p12 = score_p12(chemicals=request.chemicals, hcodes_map=hcodes_map)

    # Process complexity for waste analysis
    process_metrics = analyze_complexity(request.steps) if request.steps else None

    waste = compute_waste_analysis(
        chemicals=request.chemicals,
        hcodes_map=hcodes_map,
        process_metrics=process_metrics,
    )

    # Roll-up score and letter grade (lower is greener)
    all_scores = [p1, p2, p3, p5, p6, p11, p12]
    available = [s for s in all_scores if s.score >= 0]
    total_score = round(sum(s.score for s in available), 2)
    max_possible = float(len(available) * 10)
    pct = (total_score / max_possible * 100) if max_possible > 0 else 50.0
    grade = (
        "A" if pct <= 20 else
        "B" if pct <= 40 else
        "C" if pct <= 60 else
        "D" if pct <= 80 else
        "F"
    )

    yield_extraction = {k: v for k, v in yield_info.items() if k != "benchmark"}

    return ScoringResponse(
        scores=all_scores,
        summary="Green Chemistry Analysis complete.",
        total_score=total_score,
        max_possible=max_possible,
        grade=grade,
        waste_analysis=waste,
        yield_extraction=yield_extraction,
    )
