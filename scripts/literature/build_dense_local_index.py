#!/usr/bin/env python3
"""Pack Ollama embedding JSONL + candidate units into a Node-readable dense index."""
from __future__ import annotations
import argparse, json, struct
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", type=Path, required=True)
    ap.add_argument("--embeddings", type=Path, required=True)
    ap.add_argument("--output-dir", type=Path, required=True)
    a = ap.parse_args()

    units = {
        json.loads(line)["evidence_unit_id"]: json.loads(line)
        for line in a.candidates.read_text().splitlines() if line.strip()
    }
    emb_rows = [json.loads(line) for line in a.embeddings.read_text().splitlines() if line.strip()]
    if not emb_rows:
        raise SystemExit("no embeddings")

    model = emb_rows[0]["embedding_model"]
    dims = emb_rows[0]["dims"]
    rows = []
    matrix = bytearray()
    for er in emb_rows:
        uid = er["evidence_unit_id"]
        unit = units.get(uid)
        if not unit:
            continue
        emb = er["embedding"]
        if len(emb) != dims:
            raise SystemExit(f"dim mismatch for {uid}: {len(emb)} != {dims}")
        if er.get("embedding_model") != model:
            raise SystemExit(f"model mismatch for {uid}")
        matrix.extend(struct.pack(f"<{dims}f", *emb))
        rows.append({
            "evidence_unit_id": uid,
            "document_id": unit.get("document_id"),
            "doi": unit.get("doi"),
            "title": unit.get("title") or "",
            "page_start": unit.get("page_start"),
            "page_end": unit.get("page_end"),
            "quote": unit.get("quote") or "",
            "candidate_status": unit.get("candidate_status") or "candidate_pending_adjudication",
            "evidence_type": unit.get("evidence_type"),
            "applicability": unit.get("applicability"),
            "limitations": unit.get("limitations"),
        })

    a.output_dir.mkdir(parents=True, exist_ok=True)
    (a.output_dir / "matrix.f32").write_bytes(matrix)
    meta = {
        "embedding_model": model,
        "dims": dims,
        "count": len(rows),
        "rows": rows,
    }
    (a.output_dir / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False))
    print(json.dumps({
        "count": len(rows),
        "dims": dims,
        "model": model,
        "bytes": len(matrix),
        "output": str(a.output_dir),
    }, indent=2))


if __name__ == "__main__":
    main()
