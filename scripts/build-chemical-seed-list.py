#!/usr/bin/env python3
"""Combine curated and external chemical lists into a ranked PubChem queue."""

from __future__ import annotations

import argparse
import csv
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "data" / "chemical-seeds" / "source-manifest.json"
DEFAULT_OUTPUT = ROOT / "data" / "chemical-seeds" / "chemical-seed-list.generated.json"

NAME_COLUMNS = (
    "name",
    "chemical_name",
    "chemical name",
    "preferred_name",
    "preferred name",
    "preferredname",
    "substance_name",
    "substance name",
    "compound_name",
    "compound name",
    "dsstox_substance_name",
)
CAS_COLUMNS = ("casrn", "cas", "cas_number", "cas number", "casrn_no")
DTXSID_COLUMNS = ("dtxsid", "dsstox_substance_id", "dsstox substance id")
INCHIKEY_COLUMNS = ("inchikey", "inchi_key", "inchi key")
SMILES_COLUMNS = ("smiles", "qsar_ready_smiles", "qsar-ready smiles")


@dataclass
class ChemicalRecord:
    name: str
    score: int = 0
    sources: set[str] = field(default_factory=set)
    source_labels: set[str] = field(default_factory=set)
    categories: set[str] = field(default_factory=set)
    identifiers: dict[str, str] = field(default_factory=dict)


def normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def record_key(name: str, identifiers: dict[str, str]) -> str:
    return f"name:{normalize_name(name).lower()}"


def pick(row: dict[str, str], candidates: tuple[str, ...]) -> str:
    normalized = {
        normalize_header(key): value
        for key, value in row.items()
        if key is not None
    }
    for candidate in candidates:
        value = normalized.get(normalize_header(candidate), "")
        if value and value.strip():
            return value.strip()
    return ""


def pick_name(row: dict[str, str]) -> str:
    name = pick(row, NAME_COLUMNS)
    if name:
        return name

    for key, value in row.items():
        if key is None:
            continue
        normalized = normalize_header(key)
        if "name" in normalized and "source" not in normalized and value and value.strip():
            return value.strip()
    return ""


def clean_identifier(value: str) -> str:
    value = value.strip()
    if not value or value.upper() in {"NA", "N/A", "NULL", "NONE"}:
        return ""
    return value


def row_identifiers(row: dict[str, str]) -> dict[str, str]:
    identifiers = {
        "casrn": clean_identifier(pick(row, CAS_COLUMNS)),
        "dtxsid": clean_identifier(pick(row, DTXSID_COLUMNS)),
        "inchikey": clean_identifier(pick(row, INCHIKEY_COLUMNS)),
        "smiles": clean_identifier(pick(row, SMILES_COLUMNS)),
    }
    return {key: value for key, value in identifiers.items() if value}


def read_csv(path: Path) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8-sig") as handle:
        sample = handle.read(4096)
        handle.seek(0)
        dialect = csv.Sniffer().sniff(sample) if sample else csv.excel
        reader = csv.DictReader(handle, dialect=dialect)
        return [dict(row) for row in reader if row]


def source_path(raw_path: str) -> Path:
    path = Path(raw_path)
    return path if path.is_absolute() else ROOT / path


def ingest_source(
    records: dict[str, ChemicalRecord],
    source: dict[str, Any],
    *,
    require_existing: bool,
) -> int:
    path = source_path(source["path"])
    if not path.exists():
        if require_existing:
            raise FileNotFoundError(f"Missing source file: {path}")
        return 0

    source_id = source["id"]
    label = source.get("label", source_id)
    source_score = int(source.get("score", 1))
    count = 0

    for row in read_csv(path):
        name = normalize_name(pick_name(row))
        if not name:
            continue

        identifiers = row_identifiers(row)
        key = record_key(name, identifiers)
        record = records.setdefault(key, ChemicalRecord(name=name))
        if len(name) < len(record.name) or record.name.upper().startswith("DTXSID"):
            record.name = name

        row_score = pick(row, ("score", "priority", "weight"))
        record.score += source_score + int(float(row_score)) if row_score else source_score
        record.sources.add(source_id)
        record.source_labels.add(label)
        category = pick(row, ("category", "kind", "chemical_class", "chemical class"))
        if category:
            record.categories.add(category)
        for id_key, id_value in identifiers.items():
            record.identifiers.setdefault(id_key, id_value)
        count += 1

    return count


def as_queue_record(rank: int, record: ChemicalRecord) -> dict[str, Any]:
    return {
        "rank": rank,
        "name": record.name,
        "score": record.score,
        "identifiers": dict(sorted(record.identifiers.items())),
        "sources": sorted(record.sources),
        "source_labels": sorted(record.source_labels),
        "categories": sorted(record.categories),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=0, help="Write only the top N chemicals; 0 writes all.")
    parser.add_argument("--require-existing", action="store_true", help="Fail if any manifest CSV is missing.")
    args = parser.parse_args()

    with open(args.manifest) as handle:
        manifest = json.load(handle)

    records: dict[str, ChemicalRecord] = {}
    source_counts: dict[str, int] = {}
    for source in manifest.get("sources", []):
        source_counts[source["id"]] = ingest_source(
            records,
            source,
            require_existing=args.require_existing,
        )

    ranked = sorted(
        records.values(),
        key=lambda record: (-record.score, record.name.lower()),
    )
    if args.limit > 0:
        ranked = ranked[: args.limit]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "manifest": str(args.manifest.relative_to(ROOT)),
        "source_counts": source_counts,
        "record_count": len(ranked),
        "chemicals": [as_queue_record(idx, record) for idx, record in enumerate(ranked, start=1)],
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")

    print(f"wrote {args.output}")
    print(json.dumps({"record_count": len(ranked), "source_counts": source_counts}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
