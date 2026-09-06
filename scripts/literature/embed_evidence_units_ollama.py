#!/usr/bin/env python3
"""Generate resumable local Ollama dense embeddings for candidate evidence units."""
from __future__ import annotations
import argparse, json, time, urllib.request
from pathlib import Path

DEFAULT_MODEL = "nomic-embed-text"
OLLAMA = "http://127.0.0.1:11434/api/embed"


def embed_batch(model: str, inputs: list[str]) -> list[list[float]]:
    payload = json.dumps({"model": model, "input": inputs}).encode()
    req = urllib.request.Request(
        OLLAMA, data=payload, method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode())
    embeddings = data.get("embeddings")
    if not isinstance(embeddings, list) or len(embeddings) != len(inputs):
        raise RuntimeError(f"local_embed_response_invalid: got {type(embeddings)}")
    return embeddings


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--batch-size", type=int, default=32)
    a = ap.parse_args()

    rows = [json.loads(x) for x in a.input.read_text().splitlines() if x.strip()]
    done: dict[str, dict] = {}
    if a.output.exists():
        done = {
            json.loads(x)["evidence_unit_id"]: json.loads(x)
            for x in a.output.read_text().splitlines() if x.strip()
        }

    a.output.parent.mkdir(parents=True, exist_ok=True)
    pending = [r for r in rows if r["evidence_unit_id"] not in done]
    with a.output.open("a") as fh:
        for start in range(0, len(pending), a.batch_size):
            batch = pending[start:start + a.batch_size]
            inputs = [
                f"{r.get('title', '')}\n{r.get('quote', '')}\nSignals: {', '.join(r.get('signal_groups', []))}"
                for r in batch
            ]
            last = None
            for attempt in range(5):
                try:
                    vectors = embed_batch(a.model, inputs)
                    for r, emb in zip(batch, vectors):
                        if not isinstance(emb, list) or not emb:
                            raise RuntimeError("empty_embedding")
                        fh.write(json.dumps({
                            "evidence_unit_id": r["evidence_unit_id"],
                            "embedding_model": a.model,
                            "dims": len(emb),
                            "embedding": emb,
                        }) + "\n")
                    fh.flush()
                    last = None
                    break
                except Exception as e:
                    last = e
                    time.sleep(2 ** attempt)
            if last:
                raise last
            processed = min(start + len(batch), len(pending))
            print(json.dumps({
                "processed": processed,
                "pending": len(pending),
                "total": len(rows),
                "model": a.model,
            }), flush=True)

    print(json.dumps({
        "embedded_total": len(done) + len(pending),
        "output": str(a.output),
        "model": a.model,
    }))


if __name__ == "__main__":
    main()
