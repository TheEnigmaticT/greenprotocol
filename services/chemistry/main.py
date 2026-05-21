from fastapi import FastAPI, HTTPException
from scoring.models import ScoringRequest, ScoringResponse
from scoring.p1_waste_prevention import score_p1
from scoring.p2_atom_economy import score_p2
from scoring.p3_less_hazardous import score_p3
from scoring.p5_safer_solvents import score_p5
from scoring.p6_energy_efficiency import score_p6
from ghs import lookup_hcodes
import asyncio

app = FastAPI(title="GC.ai Chemistry Service")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/score", response_model=ScoringResponse)
async def score_protocol(request: ScoringRequest):
    """Score a protocol based on Green Chemistry principles."""
    if not request.chemicals:
        raise HTTPException(status_code=400, detail="No chemicals provided")

    # Fetch H-codes for P3
    hcodes_map = {}
    for chem in request.chemicals:
        # We need a CID to lookup H-codes. In a real pipeline, the converter provides this.
        # For scoring standalone, we skip if not provided.
        # Assuming for now we just try to get them if possible, or use empty list.
        hcodes_map[chem.name] = []

    # Calculate scores
    reaction_smiles = request.reaction_smiles
    p2 = score_p2(reaction_smiles=reaction_smiles)

    # Use the Atom Economy calculated from P2 for P1's theoretical yield calculation
    ae_pct = p2.details.get("atom_economy_pct")

    p1 = score_p1(
        chemicals=request.chemicals,
        atom_economy_pct=ae_pct
    )
    p3 = score_p3(chemicals=request.chemicals, hcodes_map=hcodes_map)
    p5 = score_p5(chemicals=request.chemicals)
    p6 = score_p6(steps=request.steps)

    return ScoringResponse(
        scores=[p1, p2, p3, p5, p6],
        summary="Green Chemistry Analysis complete."
    )
