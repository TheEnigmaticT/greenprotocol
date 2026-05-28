#!/usr/bin/env python3
"""Extract a unique chemical list from the EPA CPDat bulk ZIP."""

from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ZIP = ROOT / "data" / "chemical-seeds" / "external" / "cpdat_v4.0.zip"
DEFAULT_OUTPUT = ROOT / "data" / "chemical-seeds" / "external" / "comptox_cpdat.csv"
CPDAT_FILES = (
    "cpdat_v4.0/cpdat_v4.0_functional_use_data.csv",
    "cpdat_v4.0/cpdat_v4.0_list_presence_data.csv",
    "cpdat_v4.0/cpdat_v4.0_product_composition_data.csv",
)


@dataclass
class Chemical:
    preferred_name: str
    casrn: str = ""
    dtxsid: str = ""
    count: int = 0
    data_sources: Counter[str] = field(default_factory=Counter)
    document_types: Counter[str] = field(default_factory=Counter)


def clean(value: str | None) -> str:
    if not value:
        return ""
    value = value.strip()
    if value.lower() in {"false", "none", "null", "na", "n/a"}:
        return ""
    return value


def chemical_key(row: dict[str, str]) -> tuple[str, str]:
    dtxsid = clean(row.get("dtxsid"))
    casrn = clean(row.get("curated_casrn")) or clean(row.get("raw_casrn"))
    name = clean(row.get("curated_chemical_name")) or clean(row.get("raw_chemical_name"))
    if dtxsid:
        return ("dtxsid", dtxsid.upper())
    if casrn:
        return ("casrn", casrn.upper())
    return ("name", name.lower())


def ingest_rows(records: dict[tuple[str, str], Chemical], rows: csv.DictReader, limit: int) -> int:
    read_count = 0
    for row in rows:
        curated_name = clean(row.get("curated_chemical_name"))
        dtxsid = clean(row.get("dtxsid"))
        if not curated_name and not dtxsid:
            continue

        name = curated_name or clean(row.get("raw_chemical_name"))
        if not name:
            continue

        key = chemical_key(row)
        record = records.setdefault(
            key,
            Chemical(
                preferred_name=name,
                casrn=clean(row.get("curated_casrn")) or clean(row.get("raw_casrn")),
                dtxsid=clean(row.get("dtxsid")),
            ),
        )
        if len(name) < len(record.preferred_name):
            record.preferred_name = name
        record.casrn = record.casrn or clean(row.get("curated_casrn")) or clean(row.get("raw_casrn"))
        record.dtxsid = record.dtxsid or clean(row.get("dtxsid"))
        record.count += 1
        record.data_sources.update([clean(row.get("data_source")) or "unknown"])
        record.document_types.update([clean(row.get("data_document_type")) or "unknown"])
        read_count += 1
        if limit and read_count >= limit:
            break
    return read_count


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", type=Path, default=DEFAULT_ZIP)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit-per-file", type=int, default=0, help="Debug limit; 0 reads every row.")
    args = parser.parse_args()

    records: dict[tuple[str, str], Chemical] = {}
    source_counts: dict[str, int] = {}
    with zipfile.ZipFile(args.zip) as archive:
        for member in CPDAT_FILES:
            with archive.open(member) as raw_file:
                text_file = io.TextIOWrapper(raw_file, encoding="utf-8-sig", newline="")
                source_counts[member] = ingest_rows(
                    records,
                    csv.DictReader(text_file),
                    args.limit_per_file,
                )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", newline="") as handle:
        fieldnames = [
            "preferredName",
            "casrn",
            "dtxsid",
            "source_list",
            "cpdat_record_count",
            "cpdat_data_sources",
            "cpdat_document_types",
        ]
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for record in sorted(records.values(), key=lambda item: (-item.count, item.preferred_name.lower())):
            writer.writerow(
                {
                    "preferredName": record.preferred_name,
                    "casrn": record.casrn,
                    "dtxsid": record.dtxsid,
                    "source_list": "comptox_cpdat",
                    "cpdat_record_count": record.count,
                    "cpdat_data_sources": "; ".join(name for name, _ in record.data_sources.most_common(10)),
                    "cpdat_document_types": "; ".join(name for name, _ in record.document_types.most_common()),
                }
            )

    print(
        json.dumps(
            {
                "output": str(args.output),
                "record_count": len(records),
                "source_counts": source_counts,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
