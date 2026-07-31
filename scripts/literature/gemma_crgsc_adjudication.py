#!/usr/bin/env python3
"""Run Gemma-based provisional adjudication over extracted CRGSC articles."""
from __future__ import annotations
import argparse, json, re, time
from pathlib import Path
from urllib.request import Request, urlopen

SYSTEM = """You are adjudicating green-chemistry literature for an evidence atlas.
Return ONLY valid JSON with these keys:
relevance (one of direct,supporting,background,irrelevant,uncertain),
domain_tags (array), evidence_types (array),
scores (object with decision_surface,citable_outcome,applicability,directness integers 0-2),
rationale (one concise sentence), review_needed (boolean).
Use direct only when the article plausibly supports a specific process/material/separation/hazard decision with concrete reported evidence or a direct method comparison. Use supporting for useful context, reviews, frameworks, hazard/material/remediation context, or indirect evidence. Use background for broad context not suitable for recommendation support. Use irrelevant only when outside green chemistry decision support. Use uncertain when the excerpt is insufficient. Never invent findings, numbers, citations, or page locations."""


def call_ollama(model: str, prompt: str, timeout: int = 180) -> dict:
    payload = {"model": model, "system": SYSTEM, "prompt": prompt, "stream": False, "format": "json", "options": {"temperature": 0, "num_predict": 160}}
    req = Request("http://127.0.0.1:11434/api/generate", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=timeout) as response:
        data = json.load(response)
    raw = data.get("response", "").strip()
    obj = json.loads(raw)
    allowed = {"direct", "supporting", "background", "irrelevant", "uncertain"}
    if obj.get("relevance") not in allowed:
        raise ValueError(f"invalid relevance {obj.get('relevance')!r}")
    for key in ("domain_tags", "evidence_types"):
        if not isinstance(obj.get(key), list): obj[key] = []
    scores = obj.get("scores") or {}
    obj["scores"] = {k: int(scores.get(k, 0)) for k in ("decision_surface", "citable_outcome", "applicability", "directness")}
    obj["review_needed"] = bool(obj.get("review_needed", obj["relevance"] == "uncertain"))
    return obj


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--model", default="gemma4:12b")
    ap.add_argument("--max-chars", type=int, default=2800)
    args = ap.parse_args()
    records = [json.loads(x) for x in args.index.read_text().splitlines() if x.strip()]
    records = [r for r in records if r.get("status") == "canonical" and r.get("document_type") == "research_article"]
    done = {}
    if args.output.exists():
        for line in args.output.read_text().splitlines():
            if line.strip():
                row = json.loads(line); done[row["document_id"]] = row
    for n, record in enumerate(records, 1):
        if record["canonical_id"] in done:
            continue
        text = Path(record["text_path"]).read_text(errors="ignore")[: args.max_chars]
        prompt = f"Article metadata:\nDOI: {record.get('doi')}\nVolume/year: {record.get('volume')}/{record.get('year')}\nTitle: {record.get('title')}\n\nExtracted opening text:\n{text}\n\nAdjudicate this article conservatively."
        last = None
        for attempt in range(3):
            try:
                last = call_ollama(args.model, prompt)
                break
            except Exception as exc:
                last = exc
                time.sleep(2 ** attempt)
        if not isinstance(last, dict):
            row = {"document_id": record["canonical_id"], "doi": record.get("doi"), "title": record.get("title"), "volume": record.get("volume"), "year": record.get("year"), "gemma_error": str(last), "gemma_relevance": "uncertain", "gemma_review_needed": True}
        else:
            row = {"document_id": record["canonical_id"], "doi": record.get("doi"), "title": record.get("title"), "volume": record.get("volume"), "year": record.get("year"), "gemma_model": args.model, "gemma_relevance": last["relevance"], "gemma_domain_tags": last["domain_tags"], "gemma_evidence_types": last["evidence_types"], "gemma_scores": last["scores"], "gemma_rationale": last["rationale"], "gemma_review_needed": last["review_needed"], "adjudication_status": "provisional_model"}
        done[record["canonical_id"]] = row
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text("\n".join(json.dumps(done[r["canonical_id"]], ensure_ascii=False) for r in records if r["canonical_id"] in done) + "\n")
        if n % 10 == 0: print(json.dumps({"processed": n, "total": len(records)}), flush=True)
    print(json.dumps({"processed": len(done), "total": len(records), "output": str(args.output)}, indent=2))
    return 0

if __name__ == "__main__": raise SystemExit(main())
