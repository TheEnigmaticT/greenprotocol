"""Simple file-backed cache for PubChem lookup results."""

import json
import os
from pathlib import Path

CACHE_DIR = Path(os.environ.get("CACHE_DIR", "/tmp/chemistry-cache"))
CACHE_FILE = CACHE_DIR / "pubchem_cache.json"

_memory_cache: dict[str, dict] = {}


def _load_file_cache() -> dict[str, dict]:
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def _save_file_cache() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(CACHE_FILE, "w") as f:
        json.dump(_memory_cache, f, indent=2)


def init_cache() -> None:
    global _memory_cache
    _memory_cache = _load_file_cache()


def get(key: str) -> dict | None:
    return _memory_cache.get(key.lower().strip())


def put(key: str, value: dict) -> None:
    _memory_cache[key.lower().strip()] = value
    _save_file_cache()


def size() -> int:
    return len(_memory_cache)
