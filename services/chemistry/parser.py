"""Quantity string parser for chemistry measurements."""

import re
from dataclasses import dataclass

# Unit normalization map
UNIT_MAP: dict[str, str] = {
    # Mass
    "g": "g", "gram": "g", "grams": "g",
    "kg": "kg", "kilogram": "kg", "kilograms": "kg",
    "mg": "mg", "milligram": "mg", "milligrams": "mg",
    "µg": "µg", "ug": "µg", "microgram": "µg", "micrograms": "µg",
    # Volume
    "ml": "mL", "ml": "mL", "milliliter": "mL", "milliliters": "mL", "millilitre": "mL",
    "l": "L", "liter": "L", "liters": "L", "litre": "L", "litres": "L",
    "µl": "µL", "ul": "µL", "microliter": "µL", "microliters": "µL",
    # Moles
    "mol": "mol", "mole": "mol", "moles": "mol",
    "mmol": "mmol", "millimole": "mmol", "millimoles": "mmol",
    "µmol": "µmol", "umol": "µmol", "micromole": "µmol",
    # Equivalents
    "equiv": "equiv", "eq": "equiv", "equivalents": "equiv", "equivalent": "equiv",
}

# Conversion factors to base units (g, mL, mol)
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


@dataclass
class ParsedQuantity:
    value: float
    unit: str          # Normalized unit (g, mL, mol, equiv)
    base_value: float  # Value in base unit (g, mL, mol)
    base_unit: str     # The base unit
    raw: str           # Original string


def parse_quantity(text: str) -> ParsedQuantity | None:
    """Parse a quantity string like '5 mL', '2.3g', '100 mg'.
    
    Returns None if parsing fails.
    """
    text = text.strip()
    if not text:
        return None

    # Pattern: optional number (int or float) + optional space + unit
    pattern = r"^([\d]*\.?[\d]+)\s*([a-zA-Zµμ]+)$"
    match = re.match(pattern, text)
    if not match:
        # Try with percentage: "20% in water" -> not a simple quantity
        return None

    value = float(match.group(1))
    raw_unit = match.group(2).lower().replace("μ", "µ")

    normalized = UNIT_MAP.get(raw_unit)
    if not normalized:
        return None

    base_unit, factor = TO_BASE[normalized]
    base_value = value * factor

    return ParsedQuantity(
        value=value,
        unit=normalized,
        base_value=base_value,
        base_unit=base_unit,
        raw=text,
    )
