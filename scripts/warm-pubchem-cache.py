#!/usr/bin/env python3
"""Build a seed PubChem cache from a list of chemical names.

This is intended to run from a machine that can reach PubChem reliably.
The resulting JSON can be bundled into the Cloud Run image so hosted scoring
does not depend on live PubChem for common chemicals.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
CHEMISTRY_DIR = ROOT / "services" / "chemistry"
sys.path.insert(0, str(CHEMISTRY_DIR))

import cache  # noqa: E402
from ghs import lookup_hcodes  # noqa: E402
from pubchem import lookup_chemical  # noqa: E402
from synonyms import CHEMICAL_SYNONYMS, resolve_synonym  # noqa: E402

DEFAULT_OUTPUT = CHEMISTRY_DIR / "pubchem_cache_seed.json"


def read_names(path: Path | None) -> list[str]:
    if not path:
        names = set(CHEMICAL_SYNONYMS)
        names.update(CHEMICAL_SYNONYMS.values())
        return sorted(names, key=str.lower)

    names: list[str] = []
    with open(path, newline="") as f:
        content = f.read()
        if "," in content:
            reader = csv.reader(content.splitlines())
            for row in reader:
                if row and row[0].strip() and row[0].strip().lower() != "name":
                    names.append(row[0].strip())
        else:
            for line in content.splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    names.append(line)
    return names


def load_existing(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    with open(path) as f:
        return json.load(f)


async def warm_one(name: str, out: dict[str, dict], delay_seconds: float) -> str:
    resolved_name = resolve_synonym(name)
    key = resolved_name.lower().strip()
    if key in out:
        return "cached"

    data = await lookup_chemical(resolved_name)
    await asyncio.sleep(delay_seconds)

    if not data and resolved_name.lower() != name.lower().strip():
        data = await lookup_chemical(name)
        await asyncio.sleep(delay_seconds)

    if not data:
        return "miss"

    out[key] = data
    cid = data.get("cid")
    if cid:
        hcodes = await lookup_hcodes(int(cid))
        await asyncio.sleep(delay_seconds)
        if hcodes:
            out[f"ghs_{cid}"] = {"hcodes": hcodes}
    return "ok"


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, help="Text or CSV file; first column is chemical name")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--max", type=int, default=0, help="Maximum names to process; 0 means all")
    parser.add_argument(
        "--delay",
        type=float,
        default=1.5,
        help="Delay between PubChem calls. PubChem asks clients to stay under 5 requests/sec.",
    )
    parser.add_argument("--checkpoint-every", type=int, default=25)
    parser.add_argument("--sync-url", help="Cloud Run chemistry service URL. If set, pulls /cache/missing and posts /cache/upsert.")
    parser.add_argument("--token", help="Chemistry service token for --sync-url")
    args = parser.parse_args()

    cache.init_cache()
    out = load_existing(args.output)
    names = read_names(args.input)
    sync_missing: list[str] = []
    if args.sync_url:
        if not args.token:
            parser.error("--token is required with --sync-url")
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{args.sync_url.rstrip('/')}/cache/missing",
                headers={"X-Chemistry-Service-Token": args.token},
            )
            resp.raise_for_status()
            sync_missing = resp.json().get("missing", [])
        names = sync_missing

    if args.max > 0:
        names = names[: args.max]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    counts = {"ok": 0, "miss": 0, "cached": 0}
    for idx, name in enumerate(names, start=1):
        status = await warm_one(name, out, args.delay)
        counts[status] += 1
        print(f"[{idx}/{len(names)}] {status:6} {name}")
        if idx % args.checkpoint_every == 0:
            with open(args.output, "w") as f:
                json.dump(out, f, indent=2, sort_keys=True)

    with open(args.output, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)

    print(f"wrote {args.output}")
    print(json.dumps(counts, indent=2, sort_keys=True))

    if args.sync_url and args.token:
        hydrated = {
            name.lower().strip(): out[name.lower().strip()]
            for name in names
            if name.lower().strip() in out
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{args.sync_url.rstrip('/')}/cache/upsert",
                headers={"X-Chemistry-Service-Token": args.token},
                json={"entries": hydrated, "clear_missing": list(hydrated)},
            )
            resp.raise_for_status()
            print(json.dumps(resp.json(), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
