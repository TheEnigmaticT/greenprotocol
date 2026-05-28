"""Process complexity / transfer-loss proxy for green chemistry protocols.

Goal: Quantify transfer count, vessel count, solution-prep count, purification count, 
and workflow complexity as proxies for waste, failure risk, and operator burden.
"""

import re
from typing import List, Dict, Any
from scoring.models import ChemicalInput, PrincipleScore

# Keywords that indicate a transfer
TRANSFER_KEYWORDS = [
    r"transfer", r"pour", r"add to", r"charge", r"rinse", r"wash with", 
    r"dilute", r"extract with", r"decant", r"filter", r"cannula", 
    r"pipette", r"load", r"syringe", r"collect", r"combine"
]

# Keywords that indicate a new vessel/container
VESSEL_KEYWORDS = [
    r"flask", r"beaker", r"vial", r"funnel", r"column", r"separator", 
    r"round-bottom", r"tube", r"dish", r"filter", r"paper", r"syringe", 
    r"cannula", r"pipette"
]

# Keywords that indicate solution preparation
PREP_KEYWORDS = [
    r"dissolve", r"solution of", r"stock", r"dilute", r"prepare", 
    r"mixture of", r"suspension", r"slurry"
]

# Keywords that indicate purification steps
PURIFICATION_KEYWORDS = [
    r"purif", r"chromatograph", r"column", r"recrystalliz", r"distill", 
    r"sublim", r"filtrat", r"precipit", r"wash", r"extract"
]

def analyze_complexity(steps: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Analyze workflow steps for complexity metrics."""
    transfer_count = 0
    vessels = set()
    prep_count = 0
    purification_count = 0
    
    for step in steps:
        desc = step.get("description", "").lower()
        
        # Count transfers
        for kw in TRANSFER_KEYWORDS:
            if re.search(kw, desc):
                transfer_count += 1
                break
        
        # Count preparation steps
        for kw in PREP_KEYWORDS:
            if re.search(kw, desc):
                prep_count += 1
                break
                
        # Count purification steps
        for kw in PURIFICATION_KEYWORDS:
            if re.search(kw, desc):
                purification_count += 1
                break
        
        # Track vessels (unique by name if found)
        # This is a bit naive but better than nothing
        for kw in VESSEL_KEYWORDS:
            matches = re.findall(fr"(\w+\s+{kw}|{kw}\s+\w+|{kw})", desc)
            for m in matches:
                vessels.add(m)

    return {
        "transfer_count": transfer_count,
        "vessel_count": max(len(vessels), 1), # At least one vessel usually
        "prep_count": prep_count,
        "purification_count": purification_count,
        "step_count": len(steps)
    }

def score_process_complexity(steps: List[Dict[str, Any]]) -> PrincipleScore:
    """Calculate process complexity score (proxies for waste and failure risk).
    
    Score 0 (minimal) to 10 (extremely complex).
    """
    if not steps:
        return PrincipleScore(
            principle_number=13, # Custom principle ID for complexity
            principle_name="Process Complexity",
            score=-1.0,
            normalized=-1.0,
            details={"error": "No steps provided"},
            confidence="unavailable"
        )
        
    metrics = analyze_complexity(steps)
    
    # Heuristic scoring
    # Transfers: 1-3 = low (0-2), 4-7 = med (3-6), 8+ = high (7-10)
    transfer_score = min(10, metrics["transfer_count"] * 1.0)
    
    # Vessels: 1-2 = low (0-2), 3-5 = med (3-6), 6+ = high (7-10)
    vessel_score = min(10, (metrics["vessel_count"] - 1) * 1.5)
    
    # Preps: 0-1 = low (0-2), 2-3 = med (4-7), 4+ = high (8-10)
    prep_score = min(10, metrics["prep_count"] * 2.0)
    
    # Purification: 0-1 = low (0-3), 2 = med (6), 3+ = high (9-10)
    purif_score = min(10, metrics["purification_count"] * 3.0)
    
    # Combined score (weighted)
    # Purification is often the biggest waste source in process chemistry
    raw_score = (
        transfer_score * 0.2 +
        vessel_score * 0.2 +
        prep_score * 0.2 +
        purif_score * 0.4
    )
    
    score = round(min(10, raw_score), 2)
    
    return PrincipleScore(
        principle_number=13,
        principle_name="Process Complexity",
        score=score,
        normalized=round(score / 10.0, 4),
        details={
            **metrics,
            "complexity_level": "low" if score < 3 else "medium" if score < 7 else "high"
        },
        confidence="calculated",
        data_sources=["rule_based_analysis"]
    )
