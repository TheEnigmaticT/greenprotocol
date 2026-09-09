"""Exact chemical identity resolution shared by conversion and scoring.

The resolver deliberately recognizes only complete protocol labels, explicit
parenthetical aliases, and the curated synonym table.  It never removes inner
parentheses or performs fuzzy/sub-string matching.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from synonyms import CHEMICAL_SYNONYMS, resolve_synonym


_KNOWN_CANONICAL_NAMES = {value.casefold().strip() for value in CHEMICAL_SYNONYMS.values()}


def split_combined_alias_labels(name: str) -> tuple[str, str] | tuple[()]:
    """Return the two complete labels in ``label (alternate label)``.

    Only an outer parenthetical suffix separated by whitespace is interpreted
    as an alias. Formula parentheses such as ``Pd(PPh3)4`` remain intact.
    """
    text = name.strip()
    if not text.endswith(")"):
        return ()

    depth = 0
    opening: int | None = None
    for index in range(len(text) - 1, -1, -1):
        if text[index] == ")":
            depth += 1
        elif text[index] == "(":
            depth -= 1
            if depth == 0:
                opening = index
                break

    if opening is None or opening == 0 or not text[opening - 1].isspace():
        return ()

    primary = text[:opening].strip()
    alternate = text[opening + 1:-1].strip()
    return (primary, alternate) if primary and alternate else ()


def exact_identity_candidates(name: str) -> tuple[str, ...]:
    """Return cache lookup candidates derived only from exact known labels."""
    labels = (name.strip(), *split_combined_alias_labels(name))
    candidates: list[str] = []
    seen: set[str] = set()
    for label in labels:
        if not label:
            continue
        canonical = resolve_synonym(label)
        normalized = canonical.casefold().strip()
        if normalized not in seen:
            candidates.append(canonical)
            seen.add(normalized)
    return tuple(candidates)


def preferred_identity_name(name: str) -> str:
    """Choose a curated exact alias/canonical name, otherwise preserve input."""
    direct = resolve_synonym(name)
    if direct.casefold().strip() != name.casefold().strip():
        return direct
    if name.casefold().strip() in _KNOWN_CANONICAL_NAMES:
        return direct

    for label in split_combined_alias_labels(name):
        canonical = resolve_synonym(label)
        if (
            canonical.casefold().strip() != label.casefold().strip()
            or label.casefold().strip() in _KNOWN_CANONICAL_NAMES
        ):
            return canonical
    return direct


def resolve_cached_identity(
    name: str,
    cache_lookup: Callable[[str], dict[str, Any] | None],
) -> tuple[str, dict[str, Any] | None]:
    """Return the exact cached identity record for a requested protocol label.

    The requested name remains presentation data; callers use the returned name
    only for reference lookup.  If there is no exact cached alias record, use
    the curated exact synonym/canonical name for a later lookup.
    """
    for candidate in exact_identity_candidates(name):
        record = cache_lookup(candidate)
        if record:
            return candidate, record
    return preferred_identity_name(name), None
