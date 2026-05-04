#!/usr/bin/env python3
"""Hydrate a generated chemical seed queue into the PubChem cache slowly."""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


ROOT = Path(__file__).resolve().parents[1]
CHEMISTRY_DIR = ROOT / "services" / "chemistry"
DEFAULT_QUEUE = ROOT / "data" / "chemical-seeds" / "chemical-seed-list.generated.json"
DEFAULT_STATE = ROOT / "data" / "chemical-seeds" / "pubchem-cache-worker-state.json"
DEFAULT_OUTPUT = ROOT / "data" / "chemical-seeds" / "pubchem-cache.generated.json"

sys.path.insert(0, str(CHEMISTRY_DIR))

import cache  # noqa: E402


def load_warm_module() -> Any:
    module_path = ROOT / "scripts" / "warm-pubchem-cache.py"
    spec = importlib.util.spec_from_file_location("warm_pubchem_cache", module_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Could not load {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with open(path) as handle:
        return json.load(handle)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with open(temp_path, "w") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
        handle.write("\n")
    temp_path.replace(path)


def load_queue(path: Path) -> list[dict[str, Any]]:
    payload = load_json(path, {})
    chemicals = payload.get("chemicals", [])
    if not isinstance(chemicals, list):
        raise ValueError(f"{path} does not contain a chemicals list")
    return chemicals


async def sync_one(sync_url: str, token: str, key: str, data: dict) -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{sync_url.rstrip('/')}/cache/upsert",
            headers={"X-Chemistry-Service-Token": token},
            json={"entries": {key: data}, "clear_missing": [key]},
        )
        resp.raise_for_status()


async def run_worker() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--queue", type=Path, default=DEFAULT_QUEUE)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Writable cache JSON. Defaults to an ignored generated file.",
    )
    parser.add_argument("--delay", type=float, default=60.0, help="Seconds between chemicals.")
    parser.add_argument("--pubchem-delay", type=float, default=1.5, help="Seconds between PubChem sub-requests.")
    parser.add_argument("--limit", type=int, default=0, help="Maximum chemicals this run; 0 means forever/until exhausted.")
    parser.add_argument("--once", action="store_true", help="Process one chemical and exit.")
    parser.add_argument("--start-at", type=int, help="Override queue index, zero-based.")
    parser.add_argument("--reset", action="store_true", help="Ignore saved worker state and start at index 0.")
    parser.add_argument("--sync-url", help="Cloud Run chemistry service URL for /cache/upsert.")
    parser.add_argument("--token", help="Chemistry service token for --sync-url.")
    args = parser.parse_args()

    if args.sync_url and not args.token:
        parser.error("--token is required with --sync-url")

    warm_module = load_warm_module()
    cache.init_cache()
    out = warm_module.load_existing(args.output)
    queue = load_queue(args.queue)
    state = load_json(args.state, {})
    if args.start_at is not None:
        next_index = args.start_at
    elif args.reset:
        next_index = 0
    else:
        next_index = int(state.get("next_index", 0))
    processed = 0

    while next_index < len(queue):
        item = queue[next_index]
        name = item["name"]
        status = await warm_module.warm_one(name, out, args.pubchem_delay)
        key = name.lower().strip()
        if args.sync_url and args.token and key in out:
            await sync_one(args.sync_url, args.token, key, out[key])

        next_index += 1
        processed += 1
        state = {
            "queue": str(args.queue),
            "next_index": next_index,
            "processed_count": int(state.get("processed_count", 0)) + 1,
            "last_name": name,
            "last_status": status,
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }
        save_json(args.output, out)
        save_json(args.state, state)
        print(f"[{next_index}/{len(queue)}] {status:6} {name}")

        if args.once or (args.limit and processed >= args.limit):
            break
        await asyncio.sleep(args.delay)

    if next_index >= len(queue):
        print("queue exhausted")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run_worker()))
