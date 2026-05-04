"""Simple file-backed cache for PubChem lookup results."""

import json
import os
from pathlib import Path

CACHE_DIR = Path(os.environ.get("CACHE_DIR", "/tmp/chemistry-cache"))
CACHE_FILE = CACHE_DIR / "pubchem_cache.json"
MISSING_FILE = CACHE_DIR / "missing_chemicals.json"
SEED_CACHE_FILE = Path(__file__).with_name("pubchem_cache_seed.json")

_memory_cache: dict[str, dict] = {}
_missing_chemicals: set[str] = set()


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
    temp_file = CACHE_FILE.with_suffix(".json.tmp")
    with open(temp_file, "w") as f:
        json.dump(_memory_cache, f, indent=2)
    temp_file.replace(CACHE_FILE)


def _load_missing_file() -> set[str]:
    if MISSING_FILE.exists():
        try:
            with open(MISSING_FILE) as f:
                data = json.load(f)
            if isinstance(data, list):
                return {str(item).lower().strip() for item in data if str(item).strip()}
        except (json.JSONDecodeError, IOError):
            return set()
    return set()


def _save_missing_file() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    temp_file = MISSING_FILE.with_suffix(".json.tmp")
    with open(temp_file, "w") as f:
        json.dump(sorted(_missing_chemicals), f, indent=2)
    temp_file.replace(MISSING_FILE)


def init_cache() -> None:
    global _memory_cache, _missing_chemicals
    seed_cache: dict[str, dict] = {}
    if SEED_CACHE_FILE.exists():
        try:
            with open(SEED_CACHE_FILE) as f:
                seed_cache = json.load(f)
        except (json.JSONDecodeError, IOError):
            seed_cache = {}
    _memory_cache = {**seed_cache, **_load_file_cache()}
    _missing_chemicals = _load_missing_file()


def get(key: str) -> dict | None:
    return _memory_cache.get(key.lower().strip())


def put(key: str, value: dict) -> None:
    normalized = key.lower().strip()
    _memory_cache[normalized] = value
    _missing_chemicals.discard(normalized)
    _save_file_cache()
    _save_missing_file()


def size() -> int:
    return len(_memory_cache)


def add_missing(key: str) -> None:
    normalized = key.lower().strip()
    if normalized and normalized not in _memory_cache:
        _missing_chemicals.add(normalized)
        _save_missing_file()


def missing() -> list[str]:
    return sorted(_missing_chemicals)


def clear_missing(keys: list[str] | None = None) -> None:
    if keys is None:
        _missing_chemicals.clear()
    else:
        for key in keys:
            _missing_chemicals.discard(key.lower().strip())
    _save_missing_file()
