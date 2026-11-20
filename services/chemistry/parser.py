"""Quantity string parser for chemistry measurements.

Packet C scope: deterministic, dimension-safe parsing for:

  * single amount + supplementary mol/equiv annotations
  * single annotated amount (parenthetical label only)
  * repeated volume applications summing into a total

Strictly rejects:

  * grouped distinct formulation values (multiple tagged same-dim amounts)
  * dimension-unsafe inputs (length, percent, density, temperature, ...)
  * qualitative descriptors ("a few drops", "to taste", ...)
  * contradictory amounts ("1 g or 2 g")
  * unrelated trailing text ("5 g and then heat to 100°C")
  * saturated-solution phrases that would require inventing a mass

Public API (``parse_quantity``, ``ParsedQuantity`` with fields
``value`` / ``unit`` / ``base_value`` / ``base_unit`` / ``raw``) is
preserved. Two optional fields are added with safe defaults so existing
instantiations remain constructible:

  * ``annotations``: dict of supplementary annotations (``{"mmol": 1.75}``
    or ``{"tag": "Pb-n1"}``). Never mutates ``base_value``.
  * ``repetition``: integer count for repeated application forms
    (``"3 x 15 mL"`` → ``repetition == 3``). Defaults to ``1``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

# ---------------------------------------------------------------------------
# Unit normalization (unchanged from the pre-Packet-C parser).
# ---------------------------------------------------------------------------

UNIT_MAP: dict[str, str] = {
    # Mass
    "g": "g", "gram": "g", "grams": "g",
    "kg": "kg", "kilogram": "kg", "kilograms": "kg",
    "mg": "mg", "milligram": "mg", "milligrams": "mg",
    "µg": "µg", "ug": "µg", "microgram": "µg", "micrograms": "µg",
    # Volume
    "ml": "mL", "milliliter": "mL", "milliliters": "mL", "millilitre": "mL",
    "l": "L", "liter": "L", "liters": "L", "litre": "L", "litres": "L",
    "µl": "µL", "ul": "µL", "microliter": "µL", "microliters": "µL",
    # Moles
    "mol": "mol", "mole": "mol", "moles": "mol",
    "mmol": "mmol", "millimole": "mmol", "millimoles": "mmol",
    "µmol": "µmol", "umol": "µmol", "micromole": "µmol", "μmol": "µmol",
    # Equivalents
    "equiv": "equiv", "eq": "equiv", "equivalents": "equiv", "equivalent": "equiv",
}

# Conversion factors to base units (g, mL, mol, equiv).
TO_BASE: dict[str, tuple[str, float]] = {
    "g": ("g", 1.0),
    "kg": ("g", 1000.0),
    "mg": ("g", 0.001),
    "µg": ("g", 1e-6),
    "mL": ("mL", 1.0),
    "L": ("mL", 1000.0),
    "µL": ("mL", 0.001),
    "mol": ("mol", 1.0),
    "mmol": ("mol", 0.001),
    "µmol": ("mol", 1e-6),
    "equiv": ("equiv", 1.0),
}

# Length units are intentionally NOT in UNIT_MAP. They belong to a
# different dimension (pore size, tubing ID) and must not normalize to a
# quantity, even though their token shape can look like a mass/volume unit.
_LENGTH_UNITS = {
    "m", "cm", "mm", "µm", "μm", "um", "nm", "angstrom", "å",
}

# Units allowed in supplementary annotations: only mol-scale or equiv-scale.
_ANNOTATION_UNITS = {"mol", "mmol", "µmol", "equiv"}

# Tokens that signal "this string has procedural trailing text, not a quantity".
_REJECT_VERBS = re.compile(
    r"\b(add|added|stir|stirred|heat|heated|cool|cooled|wash|rinse|"
    r"filter|filtered|dry|dried|evaporate|evaporated|dissolve|"
    r"dissolved|mix|mixed|sonicate|sonicated|shake|shaken|"
    r"reflux|distill|concentrate)\b",
    re.IGNORECASE,
)
_REJECT_QUALITATIVE = re.compile(
    r"\b(a few|some|to taste|trace|drop|drops|drops,|"
    r"spatula|spatulas|spoonful|pinch|scoop|dash|splash|couple|"
    r"handful|batch)\b",
    re.IGNORECASE,
)
_REJECT_CONTRADICT = re.compile(r"\b(or|vs|versus|either)\b", re.IGNORECASE)

# Dimension-unsafe token shapes anywhere in the string reject.
_REJECT_TOKEN_SHAPES = re.compile(
    r"°\s*C|°\s*F|°C|°F|\d+\s*%|"
    r"g\s*/\s*mL|mg\s*/\s*mL|kg\s*/\s*L|"
    r"g\s*/\s*mol|mg\s*/\s*mol|"
    r"mol\s*/\s*L|M\b|pH\b",
    re.IGNORECASE,
)


@dataclass
class ParsedQuantity:
    """Result of a successful quantity parse.

    The five pre-existing fields are required and positional/keyword
    compatible with the original dataclass. ``annotations`` and
    ``repetition`` are new and default to safe no-op values.
    """

    value: float
    unit: str           # Normalized unit (g, mL, mol, equiv, ...)
    base_value: float   # Value in base unit (g, mL, mol, equiv)
    base_unit: str      # The base unit
    raw: str            # Original input string
    annotations: dict[str, float | str] = field(default_factory=dict)
    repetition: int = 1


def _normalize_unit(raw: str) -> Optional[str]:
    """Map a raw unit token to its canonical form, or None if not a
    recognized quantity unit.  Length units (pore size, tubing ID) are
    rejected here so they never normalize to a quantity dimension."""
    token = raw.strip().lower().replace("μ", "µ")
    if token in _LENGTH_UNITS:
        return None
    return UNIT_MAP.get(token)


def parse_quantity(text: str) -> Optional[ParsedQuantity]:
    """Parse a quantity string with deterministic, dimension-safe semantics.

    Accepts:
      - ``"<num><unit>"``                     simple form
      - ``"<num><unit> (<label>)"``           single annotated amount
      - ``"<num><unit>, <num><molunit>"``     primary + supplementary
      - ``"[wash|rinse] N x M <unit>"``       repeated applications, total = N*M

    Rejects (returns None) all inputs that would require inventing a
    density, concentration, or any dimension not literally present in
    the source string.
    """
    if text is None:
        return None
    full_raw = text.strip()
    if not full_raw:
        return None

    work = full_raw

    # Strip a leading procedural verb so "wash 3 x 15 mL" parses as a
    # repetition. Only "wash"/"rinse" are tolerated as leading verbs
    # because those are the ones whose follow-on shape is a quantity.
    leading = ""
    m_lead = re.match(r"^(wash|rinse)\s+", work, re.IGNORECASE)
    if m_lead:
        leading = m_lead.group(0)
        work = work[len(leading):].strip()
        if not work:
            return None

    # Quick reject: qualitative / contradictory / dimension-unsafe tokens.
    if _REJECT_QUALITATIVE.search(work):
        return None
    if _REJECT_CONTRADICT.search(work):
        return None
    if _REJECT_TOKEN_SHAPES.search(work):
        return None

    # 1) Repetition form: "<N> x <M> <unit>"
    rep_match = re.match(
        r"^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*([a-zA-Zµμ]+)$",
        work,
    )
    if rep_match:
        n_val = float(rep_match.group(1))
        m_val = float(rep_match.group(2))
        unit = _normalize_unit(rep_match.group(3))
        if unit is None:
            return None
        base_unit, factor = TO_BASE[unit]
        total = n_val * m_val
        # Repetition count stored as int; fractional multipliers are
        # accepted (the total volume still uses the real n_val).
        rep_count = int(n_val) if n_val == int(n_val) else int(n_val)
        return ParsedQuantity(
            value=total,
            unit=unit,
            base_value=total * factor,
            base_unit=base_unit,
            raw=full_raw,
            repetition=rep_count,
        )

    # 2) Single-segment form (no commas): one primary amount, optional label.
    if "," not in work:
        result = _parse_primary_segment(work)
        if result is None:
            return None
        result.raw = full_raw
        return result

    # 3) Multi-segment form: primary + zero-or-more supplementary annotations.
    segments = [s.strip() for s in work.split(",")]
    if any(not s for s in segments):
        return None
    primary = _parse_primary_segment(segments[0])
    if primary is None:
        return None
    primary.raw = full_raw
    for seg in segments[1:]:
        # A non-primary segment carrying parentheses is a tagged
        # same-dimension amount (distinct formulation value). Reject —
        # silently picking the first or summing would distort conversion.
        if "(" in seg or ")" in seg:
            return None
        ann = _parse_annotation_segment(seg)
        if ann is None:
            return None
        unit_key, value = ann
        primary.annotations[unit_key] = value
    return primary


def _parse_primary_segment(text: str) -> Optional[ParsedQuantity]:
    """Parse one comma-segment as the primary amount:

        "<num><unit>(<label>)?"

    Returns None if the segment does not contain a clean primary amount,
    carries a procedural verb, or has unbalanced parentheticals.
    """
    text = text.strip()
    if not text:
        return None
    if _REJECT_VERBS.search(text):
        return None

    paren_match = re.search(r"\(([^)]+)\)", text)
    paren_content: Optional[str] = None
    if paren_match:
        paren_content = paren_match.group(1).strip()
        seg_main = (text[:paren_match.start()] + text[paren_match.end():]).strip()
        # Only one parenthetical is allowed; a nested or duplicated
        # paren is structurally ambiguous and must reject.
        if "(" in seg_main or ")" in seg_main:
            return None
    else:
        seg_main = text

    amt_match = re.match(r"^(\d+\.?\d*)\s*([a-zA-Zµμ]+)$", seg_main)
    if not amt_match:
        return None
    value = float(amt_match.group(1))
    unit = _normalize_unit(amt_match.group(2))
    if unit is None:
        return None
    base_unit, factor = TO_BASE[unit]
    annotations: dict[str, float | str] = {}
    if paren_content is not None:
        annotations["tag"] = paren_content
    return ParsedQuantity(
        value=value,
        unit=unit,
        base_value=value * factor,
        base_unit=base_unit,
        raw="",  # set by the caller so the raw spans the full input
        annotations=annotations,
    )


def _parse_annotation_segment(text: str) -> Optional[tuple[str, float]]:
    """Parse a comma-segment as a supplementary annotation:

        "<num><molunit|equiv>"

    Mass, volume, length, temperature, etc. are NOT accepted as
    annotations — that would silently create a second competing primary
    amount. Returns None if the segment is not a clean mol/equiv number.
    """
    text = text.strip()
    if not text:
        return None
    if _REJECT_VERBS.search(text):
        return None
    m = re.match(
        r"^(\d+\.?\d*)\s*"
        r"(mmol|µmol|umol|μmol|mol|eq|equiv|equivalent|equivalents)$",
        text,
        re.IGNORECASE,
    )
    if not m:
        return None
    value = float(m.group(1))
    unit = _normalize_unit(m.group(2))
    if unit is None or unit not in _ANNOTATION_UNITS:
        return None
    return (unit, value)
