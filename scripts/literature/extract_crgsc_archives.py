#!/usr/bin/env python3
"""Extract article PDFs from downloaded CRGSC ZIPs.

The source ZIPs are never modified. Each unique PDF is extracted once by
SHA-256, converted to page-preserving text with PyMuPDF, and indexed in JSONL.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path
from typing import Iterable

import fitz

DOI_RE = re.compile(r"10\.1016/[A-Za-z0-9().:/_-]+", re.I)
ISSUE_RE = re.compile(
    r"Current Research in Green and Sustainable Chemistry\s+(\d+)\s+\((\d{4})\)\s+(\d+)",
    re.I,
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def clean_doi(value: str | None) -> str | None:
    if not value:
        return None
    return value.rstrip(".,;:)")


def extract_text(data: bytes) -> tuple[str, int, list[int]]:
    doc = fitz.open(stream=data, filetype="pdf")
    pages: list[str] = []
    lengths: list[int] = []
    for page in doc:
        text = page.get_text("text")
        pages.append(text)
        lengths.append(len(text))
    return "\n\n--- PAGE BREAK ---\n\n".join(pages), len(doc), lengths


def document_type(filename: str, title: str | None) -> str:
    value = f"{filename} {title or ''}".lower()
    if "contents" in value:
        return "table_of_contents"
    if "editorial board" in value or "editorial_" in value or value.startswith("editorial"):
        return "editorial"
    return "research_article"


def metadata_from_text(text: str, filename: str) -> dict:
    first_page = text.split("\n\n--- PAGE BREAK ---\n\n", 1)[0]
    issue = ISSUE_RE.search(first_page)
    doi_match = DOI_RE.search(first_page)
    doi = clean_doi(doi_match.group(0)) if doi_match else None
    lines = [line.strip() for line in first_page.splitlines() if line.strip()]
    info_index = next((i for i, line in enumerate(lines) if "A R T I C L E I N F O" in line), len(lines))
    preamble = lines[:info_index]
    filtered = []
    for line in preamble:
        low = line.lower()
        if line.startswith("Current Research in Green and Sustainable Chemistry"):
            continue
        if line.startswith("Available online") or line.startswith("2666-0865"):
            continue
        if "open access article" in low or "published by elsevier" in low:
            continue
        if "creativecommons.org" in low or low.startswith(("nc-nd/", "by-nc", "by/")):
            if ")." in line:
                line = line.split(").", 1)[1].strip()
                if not line:
                    continue
            else:
                continue
        if re.fullmatch(r"[a-z]{1,3}/\d+\.\d+.*", low):
            continue
        filtered.append(line)
    title = filtered[0] if filtered else None
    if title and len(filtered) > 1 and not any(marker in filtered[1] for marker in ("*", "**", "a ", "b ", "c ")):
        title = f"{title} {filtered[1]}"
    return {
        "filename": filename,
        "doi": doi,
        "title": title,
        "volume": int(issue.group(1)) if issue else None,
        "year": int(issue.group(2)) if issue else None,
        "article_number": issue.group(3) if issue else None,
        "open_access_signal": "open access article" in first_page.lower(),
    }


def iter_pdfs(input_dir: Path) -> Iterable[tuple[Path, str, bytes]]:
    for archive in sorted(input_dir.glob("*.zip")):
        if not (archive.name.startswith("CRGSC_") or archive.name.startswith("ScienceDirect_articles_")):
            continue
        with zipfile.ZipFile(archive) as zf:
            for info in zf.infolist():
                if info.is_dir() or not info.filename.lower().endswith(".pdf"):
                    continue
                yield archive, info.filename, zf.read(info)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    articles_dir = args.output_dir / "articles"
    articles_dir.mkdir(parents=True, exist_ok=True)
    records: list[dict] = []
    seen_hashes: dict[str, dict] = {}
    seen_dois: dict[str, dict] = {}
    archive_counts: dict[str, int] = {}

    for archive, filename, data in iter_pdfs(args.input_dir):
        archive_counts[archive.name] = archive_counts.get(archive.name, 0) + 1
        digest = sha256(data)
        if digest in seen_hashes:
            records.append({
                "status": "duplicate",
                "source_archive": archive.name,
                "source_filename": filename,
                "sha256": digest,
                "canonical_id": seen_hashes[digest]["canonical_id"],
            })
            continue

        text, page_count, page_lengths = extract_text(data)
        metadata = metadata_from_text(text, filename)
        archive_volume = re.search(r"CRGSC_Vol_(\d+)", archive.name, re.I)
        if metadata.get("volume") is None and archive_volume:
            metadata["volume"] = int(archive_volume.group(1))
        if metadata.get("volume") is None and "2021" in filename and "ScienceDirect_articles_" in archive.name:
            metadata["volume"] = 4
        metadata["document_type"] = document_type(filename, metadata.get("title"))
        if metadata.get("doi") and metadata["doi"] in seen_dois:
            records.append({
                "status": "duplicate_doi",
                "source_archive": archive.name,
                "source_filename": filename,
                "sha256": digest,
                "doi": metadata["doi"],
                "canonical_id": seen_dois[metadata["doi"]]["canonical_id"],
            })
            continue
        canonical_id = metadata["doi"] or metadata["article_number"] or digest[:16]
        canonical_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", canonical_id)
        article_dir = articles_dir / canonical_id
        article_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = article_dir / "source.pdf"
        text_path = article_dir / "text.txt"
        metadata_path = article_dir / "metadata.json"
        pdf_path.write_bytes(data)
        text_path.write_text(text, encoding="utf-8")
        record = {
            "status": "canonical",
            "canonical_id": canonical_id,
            "sha256": digest,
            "source_archive": archive.name,
            "source_filename": filename,
            "source_pdf": str(pdf_path),
            "text_path": str(text_path),
            "metadata_path": str(metadata_path),
            "page_count": page_count,
            "page_text_lengths": page_lengths,
            **metadata,
        }
        metadata_path.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        seen_hashes[digest] = record
        if metadata.get("doi"):
            seen_dois[metadata["doi"]] = record
        records.append(record)

    canonical = [r for r in records if r["status"] == "canonical"]
    articles = [r for r in canonical if r.get("document_type") == "research_article"]
    supporting = [r for r in canonical if r.get("document_type") != "research_article"]
    duplicates = [r for r in records if r["status"] in {"duplicate", "duplicate_doi"}]
    canonical.sort(key=lambda r: (r.get("volume") or 999, r.get("article_number") or "", r["canonical_id"]))
    toc = {
        "corpus": "Current Research in Green and Sustainable Chemistry",
        "generated_from": str(args.input_dir),
        "canonical_article_count": len(articles),
        "supporting_document_count": len(supporting),
        "duplicate_pdf_count": len(duplicates),
        "articles": [
            {
                "canonical_id": r["canonical_id"],
                "doi": r.get("doi"),
                "title": r.get("title"),
                "volume": r.get("volume"),
                "year": r.get("year"),
                "article_number": r.get("article_number"),
                "page_count": r["page_count"],
                "source_archive": r["source_archive"],
                "source_filename": r["source_filename"],
                "text_path": r["text_path"],
            }
            for r in articles
        ],
        "supporting_documents": [
            {
                "canonical_id": r["canonical_id"],
                "document_type": r.get("document_type"),
                "title": r.get("title"),
                "volume": r.get("volume"),
                "year": r.get("year"),
                "source_archive": r["source_archive"],
                "source_filename": r["source_filename"],
                "text_path": r["text_path"],
            }
            for r in supporting
        ],
    }
    (args.output_dir / "article-index.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n",
        encoding="utf-8",
    )
    (args.output_dir / "table-of-contents.json").write_text(json.dumps(toc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (args.output_dir / "acquisition-inventory.json").write_text(
        json.dumps({"archives": archive_counts, "canonical_articles": len(articles), "supporting_documents": len(supporting), "duplicates": len(duplicates)}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"archives": len(archive_counts), "canonical": len(canonical), "duplicates": len(duplicates), "output": str(args.output_dir)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
