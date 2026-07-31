#!/usr/bin/env python3
"""Build page-aware retrieval chunks from extracted CRGSC article text."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def words(text: str) -> list[str]:
    return re.findall(r"\S+", text)


def chunk_page(page_text: str, page_number: int, max_words: int, overlap: int):
    tokens = words(page_text)
    if not tokens:
        return
    step = max_words - overlap
    for start in range(0, len(tokens), step):
        chunk = " ".join(tokens[start : start + max_words]).strip()
        if chunk:
            yield {
                "page_start": page_number,
                "page_end": page_number,
                "text": chunk,
                "word_start": start,
                "word_end": min(start + max_words, len(tokens)),
            }
        if start + max_words >= len(tokens):
            break


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--extracted-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-words", type=int, default=260)
    parser.add_argument("--overlap", type=int, default=50)
    args = parser.parse_args()

    rows = []
    index_path = args.extracted_dir / "article-index.jsonl"
    for line in index_path.read_text(encoding="utf-8").splitlines():
        record = json.loads(line)
        if record.get("status") != "canonical" or record.get("document_type") != "research_article":
            continue
        text = Path(record["text_path"]).read_text(encoding="utf-8")
        pages = text.split("\n\n--- PAGE BREAK ---\n\n")
        for page_number, page_text in enumerate(pages, start=1):
            for chunk_number, chunk in enumerate(chunk_page(page_text, page_number, args.max_words, args.overlap)):
                rows.append({
                    "chunk_id": f"{record['canonical_id']}:p{page_number}:c{chunk_number}",
                    "document_id": record["canonical_id"],
                    "doi": record.get("doi"),
                    "title": record.get("title"),
                    "volume": record.get("volume"),
                    "year": record.get("year"),
                    "source_archive": record["source_archive"],
                    "source_filename": record["source_filename"],
                    "page_start": chunk["page_start"],
                    "page_end": chunk["page_end"],
                    "text": chunk["text"],
                    "adjudication_status": "pending",
                    "evidence_type": None,
                    "domain_tags": [],
                    "visibility": "public_source_pending_review",
                })

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
    print(json.dumps({"articles": len({row['document_id'] for row in rows}), "chunks": len(rows), "output": str(args.output)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
