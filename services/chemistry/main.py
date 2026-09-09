import os
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException
from scoring.models import ScoringRequest, ScoringResponse, ScoreProvenance
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
from scoring.waste_analysis import compute_waste_analysis
from scoring.rcra import compute_regulatory_context
from scoring.process_complexity import analyze_complexity
from ghs import lookup_hcodes
from models import BatchRequest, BatchResponse, ConvertResponse
from assistant_tools import AssistantToolPayload, AssistantToolResponse, execute_assistant_tool
from converter import convert
from yield_extractor import extract_yield_and_type
from smiles_extractor import (
    build_reaction_catalog,
    extract_reaction_smiles,
    validate_reaction_smiles,
)
import cache as chem_cache
from identity import resolve_cached_identity
from cas_lookup import get_cas
from contextlib import asynccontextmanager
import asyncio

# Auth posture: the token is REQUIRED. An unauthenticated deployment of this
# service exposes /batch, /score, and /assistant-tools — the latter two can burn
# the Anthropic key — which is exactly the July 2026 incident (a publicly tunneled
# scorer with no auth). Fail closed: refuse to boot without a token unless an
# operator explicitly opts into anonymous mode for local development.
ALLOW_ANONYMOUS = os.getenv("CHEMISTRY_SERVICE_ALLOW_ANONYMOUS") == "1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not os.getenv("CHEMISTRY_SERVICE_TOKEN") and not ALLOW_ANONYMOUS:
        raise RuntimeError(
            "CHEMISTRY_SERVICE_TOKEN is not set. Refusing to start an "
            "unauthenticated chemistry service. Set CHEMISTRY_SERVICE_TOKEN, or "
            "set CHEMISTRY_SERVICE_ALLOW_ANONYMOUS=1 to allow anonymous access "
            "(local development only)."
        )
    # Load the seeded PubChem cache (name -> cid, hcodes, smiles, MW, density)
    # for the common-chemical set so scoring has hazard data without a live
    # PubChem round-trip per chemical.
    chem_cache.init_cache()
    print(f"[startup] chemical cache loaded: {chem_cache.size()} entries")
    yield


app = FastAPI(title="GC.ai Chemistry Service", lifespan=lifespan)



def require_service_token(
    x_chemistry_service_token: str | None = Header(default=None),
) -> None:
    configured_token = os.getenv("CHEMISTRY_SERVICE_TOKEN")
    if not configured_token:
        # No token configured. Startup already refused this unless the operator
        # opted into anonymous mode, so honor that opt-in here and otherwise
        # refuse the request rather than silently serving it open (fail closed).
        if ALLOW_ANONYMOUS:
            return
        raise HTTPException(status_code=503, detail="Chemistry service auth is not configured")
    if not secrets.compare_digest(x_chemistry_service_token or "", configured_token):
        raise HTTPException(status_code=401, detail="Invalid chemistry service token")
@app.get("/health")
def health():
    return {"status": "ok", "cache_size": chem_cache.size()}

@app.post("/batch", response_model=BatchResponse, dependencies=[Depends(require_service_token)])
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


@app.post("/assistant-tools", response_model=AssistantToolResponse, dependencies=[Depends(require_service_token)])
async def assistant_tools(request: AssistantToolPayload):
    """Execute one read-only assistant chemistry lookup."""
    return await execute_assistant_tool(request)


def _hcodes_from_cache(chem_name: str) -> list[str]:
    """Resolve GHS H-codes through the shared exact chemical identity helper.

    Cached aliases are deliberately exact: ``DMF (N,N-dimethylformamide)``
    reaches the same record as DMF, while an unrelated parenthetical label does
    not inherit a cached hazard profile.
    """
    _, rec = resolve_cached_identity(chem_name, chem_cache.get)
    if not rec:
        return []
    if rec.get("ghs_hazards"):
        return [h["code"] for h in rec["ghs_hazards"] if "code" in h]
    if rec.get("hcodes"):
        return [c for c in rec["hcodes"] if isinstance(c, str)]
    cid = rec.get("cid")
    if cid is not None:
        ghs = chem_cache.get(f"ghs_{cid}")
        if ghs and ghs.get("hcodes"):
            return [c for c in ghs["hcodes"] if isinstance(c, str)]
    return []


def _reference_identity_name(chem) -> str:
    """Return the cache-resolved reference name without changing display name."""
    requested = chem.reference_name or chem.name
    resolved, _ = resolve_cached_identity(requested, chem_cache.get)
    return resolved


@app.post("/score", response_model=ScoringResponse, dependencies=[Depends(require_service_token)])
async def score_protocol(request: ScoringRequest):
    """Score a protocol based on Green Chemistry principles."""
    if not request.chemicals:
        raise HTTPException(status_code=400, detail="No chemicals provided")

    # Reference data is per occurrence. Keep protocol labels for display while
    # using the shared exact identity path for reference-only lookups.
    chemical_records = [
        {
            "name": chem.name,
            "role": chem.role,
            "quantity": chem.raw_quantity if chem.raw_quantity is not None else chem.quantity,
            "reference_name": chem.reference_name,
            "reference_smiles": chem.reference_smiles,
            "reference_status": chem.reference_status,
            "reference_provenance": chem.reference_provenance,
        }
        for chem in request.chemicals
    ]

    # Read GHS H-codes from the verified occurrence when supplied, otherwise
    # from the converter cache through the same exact alias resolver.
    hcodes_map: dict[str, list[str]] = {}
    for chem in request.chemicals:
        hcodes_map[chem.name] = (
            list(chem.reference_hcodes)
            if chem.reference_hcodes is not None
            else _hcodes_from_cache(chem.reference_name or chem.name)
        )

    # Extract yield and reaction type for P1 PMI calculation.
    yield_info: dict = {}
    if request.protocol_text:
        try:
            yield_info = await extract_yield_and_type(request.protocol_text, chemical_records)
        except Exception as e:
            print(f"[score] yield extraction failed: {e}")

    # Caller-provided and model-inferred reactions follow the same minimal
    # parseability + verified-identity checks. A failure only withholds P2.
    known_reactants, declared_products, unresolved_participants = build_reaction_catalog(chemical_records)
    desired_product_index = 0
    smiles_metadata: dict = {
        "provided": bool(request.reaction_smiles),
        "llm_called": False,
        "inferred": False,
        "validated": False,
        "identity_validation": "not_attempted",
        "known_reactants": [item["name"] for item in known_reactants],
        "declared_products": [item["name"] for item in declared_products],
        "validation_errors": [],
    }
    reaction_smiles = request.reaction_smiles
    if reaction_smiles and unresolved_participants:
        reaction_smiles = None
        smiles_metadata.update({
            "identity_validation": "unavailable",
            "validation_errors": ["Unresolved declared reaction participants: " + ", ".join(unresolved_participants)],
        })
    elif reaction_smiles:
        valid, reason, product_index = validate_reaction_smiles(
            reaction_smiles,
            known_reactants=known_reactants,
            declared_products=declared_products,
        )
        if valid:
            desired_product_index = product_index or 0
            smiles_metadata.update({
                "validated": True,
                "identity_validation": "parseable_and_identity_consistent",
                "desired_product_index": product_index,
            })
        else:
            reaction_smiles = None
            smiles_metadata.update({
                "identity_validation": "failed",
                "validation_errors": [reason],
            })
    elif request.protocol_text:
        try:
            reaction_smiles, extracted_metadata = await extract_reaction_smiles(
                request.protocol_text,
                chemical_records,
            )
            smiles_metadata.update(extracted_metadata)
            if reaction_smiles:
                valid, reason, product_index = validate_reaction_smiles(
                    reaction_smiles,
                    known_reactants=known_reactants,
                    declared_products=declared_products,
                )
                if valid:
                    desired_product_index = product_index or 0
                    smiles_metadata.update({
                        "validated": True,
                        "identity_validation": "parseable_and_identity_consistent",
                        "desired_product_index": product_index,
                    })
                else:
                    reaction_smiles = None
                    smiles_metadata.update({
                        "validated": False,
                        "identity_validation": "failed",
                    })
                    smiles_metadata.setdefault("validation_errors", []).append(reason)
        except Exception as e:
            print(f"[score] reaction SMILES extraction failed: {e}")
            reaction_smiles = None
            smiles_metadata.update({
                "llm_called": True,
                "identity_validation": "failed",
                "validation_errors": [str(e)],
            })

    # Predicting an unnamed product is a separate, explicitly inferred mode;
    # it must not be represented as a verified declared product identity.
    product_provenance = (
        "unavailable" if not reaction_smiles else
        "declared" if declared_products else
        "caller-provided" if request.reaction_smiles else "model-inferred"
    )
    smiles_metadata["product_provenance"] = product_provenance
    if product_provenance == "model-inferred":
        smiles_metadata["identity_validation"] = "reactants_verified_product_inferred"

    # Calculate scores
    p2 = score_p2(
        reaction_smiles=reaction_smiles,
        desired_product_index=desired_product_index,
    )
    if product_provenance == "model-inferred" and p2.score >= 0:
        p2.confidence = ScoreProvenance.MODEL_INFERRED
        p2.details["product_provenance"] = product_provenance
        p2.details["input_limitation"] = "Product predicted by the configured model, not declared in the procedure."
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
    p4 = score_p4(chemicals=request.chemicals, hcodes_map=hcodes_map)
    p5 = score_p5(chemicals=request.chemicals)
    p6 = score_p6(steps=request.steps)
    p7 = score_p7(chemicals=request.chemicals)
    p8 = await score_p8(steps=request.steps, protocol_text=request.protocol_text)
    p9 = score_p9(chemicals=request.chemicals)
    p10 = score_p10(chemicals=request.chemicals, hcodes_map=hcodes_map)
    p11 = await score_p11(steps=request.steps, protocol_text=request.protocol_text)
    p12 = score_p12(chemicals=request.chemicals, hcodes_map=hcodes_map)

    # Process complexity for waste analysis
    process_metrics = analyze_complexity(request.steps) if request.steps else None

    waste = compute_waste_analysis(
        chemicals=request.chemicals,
        hcodes_map=hcodes_map,
        process_metrics=process_metrics,
    )

    # Compliance-context evidence layer (RCRA). Not a scoring input; kept as a
    # distinct block so score-driving hazard data stays separate from regulatory
    # annotations. CAS (from the seeded common-chemical set) enables
    # authoritative CAS-keyed matching where available.
    cas_map = {
        chem.name: cas
        for chem in request.chemicals
        if (cas := get_cas(_reference_identity_name(chem)) or get_cas(chem.name))
    }
    waste["regulatoryContext"] = compute_regulatory_context(
        chemicals=request.chemicals,
        hcodes_map=hcodes_map,
        cas_map=cas_map,
    )

    # Roll-up score and letter grade (lower is greener)
    all_scores = [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12]
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
        smiles_extraction=smiles_metadata,
        yield_extraction=yield_extraction,
    )
