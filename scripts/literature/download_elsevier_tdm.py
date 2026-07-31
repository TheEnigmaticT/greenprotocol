#!/usr/bin/env python3
"""Download rights-recorded Elsevier full-text XML for a manifest.

This is a local acquisition utility, not a redistribution or model-training
permission mechanism. It only downloads records with a Creative Commons license
by default and preserves response metadata beside each XML artifact.
"""
from __future__ import annotations

import argparse
import json
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


def has_cc_license(record: dict) -> bool:
    return any("creativecommons.org" in (lic.get("URL") or "") for lic in record.get("licenses", []))


def safe_name(doi: str) -> str:
    return doi.replace("/", "__").replace(":", "_")


def download(record: dict, output_dir: Path, user_agent: str) -> dict:
    doi = record["doi"]
    links = [link for link in record.get("links", []) if link.get("content_type") == "text/xml"]
    if not links:
        return {"doi": doi, "status": "no_xml_link"}

    base = output_dir / safe_name(doi)
    xml_path = Path(str(base) + ".xml")
    meta_path = Path(str(base) + ".json")
    if xml_path.exists() and meta_path.exists():
        return {"doi": doi, "status": "already_present", "path": str(xml_path)}

    url = links[0]["URL"]
    request = Request(url, headers={"User-Agent": user_agent, "Accept": "text/xml"})
    try:
        with urlopen(request, timeout=60) as response:
            body = response.read()
            response_meta = {
                "doi": doi,
                "url": url,
                "http_status": response.status,
                "content_type": response.headers.get("Content-Type"),
                "content_length": len(body),
                "retrieved_at": "2026-07-29",
                "source_license": record.get("licenses", []),
            }
        xml_path.write_bytes(body)
        meta_path.write_text(json.dumps(response_meta, indent=2) + "\n")
        try:
            root = ET.fromstring(body)
            tags = {element.tag.rsplit("}", 1)[-1] for element in root.iter()}
            status = "downloaded" if "originalText" in tags or "full-text" in tags else "metadata_only"
        except ET.ParseError:
            status = "invalid_xml"
        return {"doi": doi, "status": status, "bytes": len(body), "path": str(xml_path)}
    except (HTTPError, URLError, TimeoutError) as exc:
        return {"doi": doi, "status": "error", "error": str(exc), "url": url}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--include-non-cc", action="store_true")
    parser.add_argument("--delay", type=float, default=0.2)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text())
    records = manifest["records"]
    if not args.include_non_cc:
        records = [record for record in records if has_cc_license(record)]
    if args.limit:
        records = records[: args.limit]

    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    for index, record in enumerate(records, start=1):
        result = download(record, args.output, "greenchemistry-ai-literature-ingestion/0.1")
        results.append(result)
        print(f"[{index}/{len(records)}] {result['status']} {result['doi']}", flush=True)
        time.sleep(args.delay)

    summary = {
        "requested": len(records),
        "downloaded": sum(r["status"] == "downloaded" for r in results),
        "metadata_only": sum(r["status"] == "metadata_only" for r in results),
        "invalid_xml": sum(r["status"] == "invalid_xml" for r in results),
        "already_present": sum(r["status"] == "already_present" for r in results),
        "errors": sum(r["status"] == "error" for r in results),
        "no_xml_link": sum(r["status"] == "no_xml_link" for r in results),
        "results": results,
    }
    (args.output / "acquisition-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({k: summary[k] for k in summary if k != "results"}))
    return 1 if summary["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
