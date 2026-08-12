#!/usr/bin/env python3
"""Import canonical CRGSC source documents and candidate evidence units into Supabase."""
from __future__ import annotations

import argparse
import hashlib
import json
import json as json_module
import math
import os
import tempfile
from pathlib import Path
from typing import Any, Iterable, Mapping
from urllib.error import HTTPError
from urllib.request import Request, urlopen

VECTOR_DIMENSIONS = 1536
SOURCE_COLUMNS = (
    "id", "doi", "title", "journal", "volume", "year", "source_pdf", "text_path",
    "source_checksum", "rights_status", "document_type", "visibility", "tenant_id", "metadata",
)
UNIT_COLUMNS = (
    "id", "source_document_id", "doi", "title", "page_start", "page_end", "section", "quote",
    "normalized_claim", "evidence_type", "signal_groups", "inputs", "outputs", "operation_type",
    "reagents", "solvents", "catalysts", "conditions", "reported_metrics", "comparison_target",
    "applicability", "limitations", "candidate_status", "visibility", "tenant_id", "embedding_model",
    "embedding", "metadata",
)


class HttpResponse:
    def __init__(self, status_code: int, text: str = "") -> None:
        self.status_code = status_code
        self.text = text


class UrllibSession:
    """Small requests-compatible transport used when no test transport is injected."""

    def post(self, url: str, *, json: Any, headers: Mapping[str, str], timeout: int) -> HttpResponse:
        request = Request(url, data=json_module.dumps(json).encode("utf-8"), headers=dict(headers), method="POST")
        try:
            with urlopen(request, timeout=timeout) as response:
                return HttpResponse(response.status, response.read().decode("utf-8", errors="replace"))
        except HTTPError as error:
            return HttpResponse(error.code, error.read().decode("utf-8", errors="replace"))


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"{path}:{line_number}: invalid JSON") from error
        if not isinstance(row, dict):
            raise ValueError(f"{path}:{line_number}: expected object")
        rows.append(row)
    return rows


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _required_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")
    return value


def _record_with_columns(record: Mapping[str, Any], columns: Iterable[str]) -> dict[str, Any]:
    return {column: record[column] for column in columns if column in record and record[column] is not None}


def load_canonical_sources(article_index: Path) -> dict[str, dict[str, Any]]:
    sources: dict[str, dict[str, Any]] = {}
    for row in _read_jsonl(article_index):
        if row.get("status") != "canonical" or row.get("document_type") != "research_article":
            continue
        canonical_id = _required_text(row.get("canonical_id"), "canonical_id")
        _required_text(row.get("title"), "source document title")
        if canonical_id in sources:
            raise ValueError(f"duplicate canonical source document ID: {canonical_id}")
        sources[canonical_id] = row
    return sources


def load_embeddings(embeddings_path: Path) -> dict[str, dict[str, Any]]:
    embeddings: dict[str, dict[str, Any]] = {}
    for row in _read_jsonl(embeddings_path):
        unit_id = _required_text(row.get("evidence_unit_id"), "embedding evidence_unit_id")
        if unit_id in embeddings:
            raise ValueError(f"duplicate embedding ID: {unit_id}")
        embeddings[unit_id] = row
    return embeddings


def build_import_batches(
    sources: Mapping[str, Mapping[str, Any]],
    evidence_units: Iterable[Mapping[str, Any]],
    embeddings: Mapping[str, Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Validate joined records and construct Supabase-safe upsert payloads."""
    documents: list[dict[str, Any]] = []
    valid_sources: dict[str, Mapping[str, Any]] = {}
    for document_id, source in sources.items():
        canonical_id = _required_text(source.get("canonical_id"), "canonical_id")
        if document_id != canonical_id:
            raise ValueError(f"source document key does not match canonical_id: {document_id}")
        if source.get("status") != "canonical" or source.get("document_type") != "research_article":
            raise ValueError(f"source document {document_id} is not canonical research_article")
        payload = _record_with_columns(source, SOURCE_COLUMNS)
        payload["id"] = canonical_id
        if "source_checksum" not in payload and source.get("sha256") is not None:
            payload["source_checksum"] = source["sha256"]
        _required_text(payload.get("title"), "source document title")
        documents.append(payload)
        valid_sources[document_id] = source

    imported_units: list[dict[str, Any]] = []
    seen_unit_ids: set[str] = set()
    for unit in evidence_units:
        unit_id = _required_text(unit.get("evidence_unit_id"), "evidence_unit_id")
        if unit_id in seen_unit_ids:
            raise ValueError(f"duplicate evidence unit ID: {unit_id}")
        seen_unit_ids.add(unit_id)
        document_id = _required_text(unit.get("document_id"), "document_id")
        source = valid_sources.get(document_id)
        if source is None:
            raise ValueError(f"source document not found or not canonical: {document_id}")
        title = _required_text(unit.get("title"), "evidence unit title")
        page_start, page_end = unit.get("page_start"), unit.get("page_end")
        if isinstance(page_start, bool) or isinstance(page_end, bool) or not isinstance(page_start, int) or not isinstance(page_end, int) or page_start < 1 or page_end < page_start:
            raise ValueError(f"invalid page range for evidence unit {unit_id}")
        _required_text(unit.get("quote"), "evidence quote")
        if not isinstance(unit.get("signal_groups"), list) or not all(isinstance(group, str) and group for group in unit["signal_groups"]):
            raise ValueError(f"signal_groups must be a list of nonempty strings for evidence unit {unit_id}")
        candidate_status = _required_text(unit.get("candidate_status", "candidate_pending_adjudication"), "candidate_status")
        embedding = embeddings.get(unit_id)
        if embedding is None:
            raise ValueError(f"missing embedding for evidence unit {unit_id}")
        embedding_model = _required_text(embedding.get("embedding_model"), "embedding model")
        if embedding_model != "text-embedding-3-small":
            raise ValueError(f"embedding model must be text-embedding-3-small for evidence unit {unit_id}")
        vector = embedding.get("embedding")
        if not isinstance(vector, list) or len(vector) != VECTOR_DIMENSIONS or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in vector):
            raise ValueError(f"embedding must contain exactly {VECTOR_DIMENSIONS} finite values for evidence unit {unit_id}")
        payload = _record_with_columns(unit, UNIT_COLUMNS)
        payload.update({
            "id": unit_id,
            "source_document_id": document_id,
            "doi": unit.get("doi") or source.get("doi"),
            "title": title,
            "page_start": page_start,
            "page_end": page_end,
            "quote": unit["quote"],
            "signal_groups": unit["signal_groups"],
            "candidate_status": candidate_status,
            "embedding_model": embedding_model,
            "embedding": vector,
        })
        imported_units.append(payload)
    return documents, imported_units


def _atomic_write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False) as handle:
        temp_path = Path(handle.name)
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp_path, path)


def _read_manifest(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid manifest: {path}") from error
    if not isinstance(payload, dict):
        raise ValueError(f"invalid manifest: {path}")
    return payload


def _response_is_success(response: Any) -> bool:
    return 200 <= getattr(response, "status_code", 0) < 300


def _post(session: Any, url: str, payload: list[dict[str, Any]], headers: Mapping[str, str]) -> None:
    response = session.post(url, json=payload, headers=headers, timeout=30)
    if not _response_is_success(response):
        raise RuntimeError(f"Supabase upsert failed with status {getattr(response, 'status_code', 'unknown')}: {getattr(response, 'text', '')}")


def import_evidence(
    article_index: Path,
    evidence_path: Path,
    embeddings_path: Path,
    manifest_path: Path,
    supabase_url: str,
    service_role_key: str,
    *,
    session: Any | None = None,
    batch_size: int = 100,
) -> dict[str, Any]:
    if batch_size < 1:
        raise ValueError("batch_size must be positive")
    article_index, evidence_path, embeddings_path, manifest_path = map(Path, (article_index, evidence_path, embeddings_path, manifest_path))
    sources = load_canonical_sources(article_index)
    evidence_rows = _read_jsonl(evidence_path)
    embeddings = load_embeddings(embeddings_path)
    documents, units = build_import_batches(sources, evidence_rows, embeddings)
    checksums = {str(path): _sha256(path) for path in (article_index, evidence_path, embeddings_path)}
    existing = _read_manifest(manifest_path)
    if existing is not None and existing.get("checksums") != checksums:
        raise ValueError("manifest checksum mismatch; refusing to resume with changed inputs")
    if existing is not None and existing.get("complete") is True:
        return existing

    manifest = existing or {}
    completed_unit_id = manifest.get("completed_unit_id")
    try:
        completed_unit_count = int(manifest.get("completed_unit_count", 0))
        completed_batch_count = int(manifest.get("completed_batch_count", 0))
        completed_source_count = int(manifest.get("completed_source_count", 0))
    except (TypeError, ValueError) as error:
        raise ValueError("manifest completion counts are invalid") from error
    if min(completed_unit_count, completed_batch_count, completed_source_count) < 0:
        raise ValueError("manifest completion counts are invalid")
    start_index = 0
    if completed_unit_id is not None:
        ids = [unit["id"] for unit in units]
        if completed_unit_id not in ids:
            raise ValueError("manifest completed unit ID is absent from validated input")
        start_index = ids.index(completed_unit_id) + 1
        if completed_unit_count != start_index:
            raise ValueError("manifest completed unit count is inconsistent with completed unit ID")
    elif completed_unit_count != 0:
        raise ValueError("manifest completed unit count requires a completed unit ID")
    if completed_source_count > len(documents) or completed_unit_count > len(units):
        raise ValueError("manifest completion counts exceed validated input")
    manifest.update({
        "checksums": checksums,
        "source_count": len(documents),
        "unit_count": len(units),
        "batch_count": math.ceil(len(units) / batch_size),
        "complete": False,
        "completed_source_count": completed_source_count,
        "completed_unit_count": completed_unit_count,
        "completed_batch_count": completed_batch_count,
        "completed_unit_id": completed_unit_id,
    })
    _atomic_write_json(manifest_path, manifest)


    transport = session or UrllibSession()
    base_url = supabase_url.rstrip("/")
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    if manifest["completed_source_count"] < len(documents):
        _post(transport, f"{base_url}/rest/v1/literature_source_documents?on_conflict=id", documents, headers)
        manifest["completed_source_count"] = len(documents)
        _atomic_write_json(manifest_path, manifest)

    for offset in range(start_index, len(units), batch_size):
        batch = units[offset:offset + batch_size]
        _post(transport, f"{base_url}/rest/v1/literature_evidence_units?on_conflict=id", batch, headers)
        manifest["completed_unit_id"] = batch[-1]["id"]
        manifest["completed_unit_count"] = offset + len(batch)
        manifest["completed_batch_count"] += 1
        _atomic_write_json(manifest_path, manifest)

    manifest["complete"] = True
    _atomic_write_json(manifest_path, manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--article-index", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--embeddings", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--batch-size", type=int, default=100)
    args = parser.parse_args()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    result = import_evidence(args.article_index, args.evidence, args.embeddings, args.manifest, url, key, batch_size=args.batch_size)
    print(json.dumps({key: result[key] for key in ("source_count", "unit_count", "batch_count", "complete")}, sort_keys=True))


if __name__ == "__main__":
    main()
