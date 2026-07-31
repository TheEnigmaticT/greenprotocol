#!/usr/bin/env python3
"""Create transparent, conservative provisional CRGSC adjudication labels.

This is intentionally not a final adjudicator. It produces explainable labels
for human calibration while the local LLM runtime is unavailable.
"""
from __future__ import annotations

import argparse
import json
import random
import re
from collections import defaultdict
from pathlib import Path

DIRECT_TERMS = {
    "solvent": "solvent_or_reagent_assessment", "reagent": "solvent_or_reagent_assessment",
    "catal": "process_method", "synthesi": "process_method", "reaction": "process_method",
    "one-pot": "process_method", "process": "process_method", "purif": "process_method",
    "extract": "process_method", "separation": "process_method", "electrochemical": "process_method",
    "optimization": "experimental_comparison", "yield": "experimental_comparison",
    "energy": "experimental_comparison", "temperature": "experimental_comparison",
    "waste": "experimental_comparison", "biodiesel": "process_method",
}
SUPPORTING_TERMS = {
    "review": "review_or_framework", "perspective": "review_or_framework", "framework": "review_or_framework",
    "life cycle": "life_cycle_assessment", "lca": "life_cycle_assessment",
    "hazard": "hazard_assessment", "toxicity": "hazard_assessment", "remediation": "remediation_or_wastewater",
    "wastewater": "remediation_or_wastewater", "adsorption": "remediation_or_wastewater",
    "recycl": "materials_or_circularity", "upcycl": "materials_or_circularity",
    "biomass": "materials_or_circularity", "nanoparticle": "materials_or_circularity",
    "nanocomposite": "materials_or_circularity", "material": "materials_or_circularity",
    "monitor": "analytical_method", "sensor": "analytical_method", "simulation": "simulation_or_modeling",
    "modeling": "simulation_or_modeling", "dft": "simulation_or_modeling",
}
DOMAIN_TERMS = {
    "reaction": ["reaction", "synthesi", "catal", "one-pot", "electrochemical", "biodiesel"],
    "solvent_process": ["solvent", "reagent", "purif", "extract", "separation", "process", "reaction"],
    "materials_circularity": ["material", "recycl", "upcycl", "biomass", "nanoparticle", "nanocomposite", "polymer"],
    "remediation_wastewater": ["remediation", "wastewater", "adsorption", "pollutant", "contaminated water"],
    "energy_efficiency": ["energy", "temperature", "microwave", "ultrasound", "electrochemical"],
}


def tags_for(text: str, mapping: dict[str, str]) -> list[str]:
    return sorted({tag for term, tag in mapping.items() if term in text})


def classify(record: dict, text: str) -> dict:
    title = (record.get("title") or "").lower()
    excerpt = text[:5000].lower()
    corpus = f"{title} {excerpt}"
    evidence_types = tags_for(corpus, {**DIRECT_TERMS, **SUPPORTING_TERMS})
    domain_tags = [domain for domain, terms in DOMAIN_TERMS.items() if any(term in corpus for term in terms)]
    direct_hits = [term for term in DIRECT_TERMS if term in corpus]
    support_hits = [term for term in SUPPORTING_TERMS if term in corpus]
    is_review = any(term in title for term in ("review", "perspective", "overview", "state of the art"))
    is_experimental = any(term in corpus for term in ("experiment", "synthesized", "synthesis", "prepared", "yield", "optimization", "characterization"))

    decision_surface = min(2, len(domain_tags))
    citable_outcome = 2 if is_experimental or any(term in corpus for term in ("life cycle", "hazard", "toxicity", "recycling")) else 1
    applicability = 2 if domain_tags else 0
    directness = 1 if is_review or support_hits and not direct_hits else 2 if is_experimental else 1
    total = decision_surface + citable_outcome + applicability + directness

    if not domain_tags:
        relevance = "uncertain"
        rationale = "No configured GreenChemistry.ai domain signal; human review required."
    elif is_review and total >= 4:
        relevance = "supporting"
        rationale = "Review/framework signal; retain as supporting context, not sole direct recommendation evidence."
    elif direct_hits and is_experimental and total >= 6:
        relevance = "direct"
        rationale = "Experimental/process signal maps to a configured decision surface; provisional direct label requires human calibration."
    elif total >= 4:
        relevance = "supporting"
        rationale = "Relevant domain or sustainability signal, but direct applicability is limited or indirect."
    else:
        relevance = "background"
        rationale = "Adjacent green/sustainable chemistry signal without enough direct decision support."

    return {
        "document_id": record["canonical_id"],
        "doi": record.get("doi"),
        "title": record.get("title"),
        "volume": record.get("volume"),
        "year": record.get("year"),
        "provisional_relevance": relevance,
        "domain_tags": domain_tags,
        "evidence_types": evidence_types,
        "scores": {
            "decision_surface": decision_surface,
            "citable_outcome": citable_outcome,
            "applicability": applicability,
            "directness": directness,
            "total": total,
        },
        "rationale": rationale,
        "signal_terms": sorted(set(direct_hits + support_hits)),
        "adjudication_status": "provisional_deterministic",
        "adjudication_version": "crgsc-v1-deterministic-2026-07-29",
        "human_relevance": "pending",
        "human_domain_tags": [],
        "human_evidence_types": [],
        "human_notes": "",
        "reviewer": "",
        "source_pdf": record.get("source_pdf"),
        "text_path": record.get("text_path"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--calibration-output", type=Path, required=True)
    args = parser.parse_args()
    records = [json.loads(line) for line in args.index.read_text().splitlines()]
    records = [r for r in records if r.get("status") == "canonical" and r.get("document_type") == "research_article"]
    provisional = []
    for record in records:
        text = Path(record["text_path"]).read_text(errors="ignore")
        provisional.append(classify(record, text))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in provisional) + "\n")

    groups = defaultdict(list)
    for row in provisional:
        groups[row["provisional_relevance"]].append(row)
    rng = random.Random(20260729)
    calibration = []
    for label, count in (("direct", 10), ("supporting", 10)):
        candidates = groups[label][:]
        rng.shuffle(candidates)
        calibration.extend(candidates[:count])
    selected = {r["document_id"] for r in calibration}
    low_confidence = sorted(
        [r for r in provisional if r["document_id"] not in selected],
        key=lambda r: (r["scores"]["total"], r["document_id"]),
    )[:10]
    calibration.extend(low_confidence)
    for i, row in enumerate(calibration, 1):
        row["calibration_order"] = i
        row["calibration_bucket"] = (
            "direct" if i <= 10 else "supporting" if i <= 20 else "low_confidence_review"
        )
        row["human_relevance"] = "pending"
        row["human_notes"] = ""
    args.calibration_output.parent.mkdir(parents=True, exist_ok=True)
    args.calibration_output.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in calibration) + "\n")
    from collections import Counter
    print(json.dumps({"articles": len(provisional), "provisional_states": Counter(r["provisional_relevance"] for r in provisional), "calibration": len(calibration)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
