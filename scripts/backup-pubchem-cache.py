#!/usr/bin/env python3
"""Create timestamped backups of the generated PubChem cache worker files."""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT / "data" / "chemical-seeds" / "pubchem-cache.generated.json"
DEFAULT_STATE = ROOT / "data" / "chemical-seeds" / "pubchem-cache-worker-state.json"
DEFAULT_BACKUP_DIR = ROOT / "data" / "chemical-seeds" / "backups"


def validate_json(path: Path) -> None:
    with open(path) as handle:
        json.load(handle)


def backup_file(source: Path, backup_dir: Path, timestamp: str) -> Path | None:
    if not source.exists():
        return None
    validate_json(source)
    target = backup_dir / f"{source.stem}.{timestamp}{source.suffix}"
    shutil.copy2(source, target)
    return target


def prune_backups(backup_dir: Path, stem: str, keep: int) -> None:
    if keep <= 0:
        return
    backups = sorted(
        backup_dir.glob(f"{stem}.*.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for stale in backups[keep:]:
        stale.unlink()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--backup-dir", type=Path, default=DEFAULT_BACKUP_DIR)
    parser.add_argument("--keep", type=int, default=72, help="Number of backups to retain per file.")
    args = parser.parse_args()

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    args.backup_dir.mkdir(parents=True, exist_ok=True)

    written = [
        path
        for path in (
            backup_file(args.cache, args.backup_dir, timestamp),
            backup_file(args.state, args.backup_dir, timestamp),
        )
        if path is not None
    ]

    prune_backups(args.backup_dir, args.cache.stem, args.keep)
    prune_backups(args.backup_dir, args.state.stem, args.keep)

    for path in written:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
