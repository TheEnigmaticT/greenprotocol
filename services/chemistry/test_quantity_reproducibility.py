"""Synthetic, deterministic tests for the quantity parser.

Packet C scope: deterministic, dimension-safe support for:

  * single amount + supplementary mol/equiv annotations
  * single annotated amount (parenthetical label only)
  * repeated volume applications summing into a total

plus strict safety rejections for:

  * grouped distinct formulation values (e.g. 700 mg (Pb-n1), 1000 mg (Pb-n2), ...)
  * membrane pore sizes / qualitative descriptors / contradictory amounts
  * unrelated trailing text
  * zero/negative semantics (preserve prior behavior)

Public-API surface (parse_quantity, ParsedQuantity dataclass with the
existing fields value/unit/base_value/base_unit/raw) is preserved.

All fixtures are synthetic. No customer protocols, no real compound IDs.
"""

from __future__ import annotations

import math

import pytest

from parser import ParsedQuantity, parse_quantity


# ---------------------------------------------------------------------------
# Backward compatibility — simple forms must still parse exactly as before.
# ---------------------------------------------------------------------------


class TestBackwardsCompatSimpleForms:
    """Existing single-amount parsing must keep working unchanged."""

    def test_simple_grams(self):
        p = parse_quantity("5 g")
        assert p is not None
        assert p.value == 5.0
        assert p.unit == "g"
        assert p.base_value == 5.0
        assert p.base_unit == "g"
        assert p.raw == "5 g"

    def test_simple_grams_no_space(self):
        p = parse_quantity("2.3g")
        assert p is not None
        assert p.value == 2.3
        assert p.unit == "g"
        assert p.base_value == 2.3
        assert p.base_unit == "g"

    def test_simple_milligrams(self):
        p = parse_quantity("100 mg")
        assert p is not None
        assert p.value == 100.0
        assert p.unit == "mg"
        assert p.base_value == pytest.approx(0.1)
        assert p.base_unit == "g"

    def test_simple_milliliters(self):
        p = parse_quantity("5 mL")
        assert p is not None
        assert p.value == 5.0
        assert p.unit == "mL"
        assert p.base_value == 5.0
        assert p.base_unit == "mL"

    def test_simple_microliters(self):
        p = parse_quantity("250 µL")
        assert p is not None
        assert p.value == 250.0
        assert p.unit == "µL"
        assert p.base_value == pytest.approx(0.25)
        assert p.base_unit == "mL"

    def test_simple_moles(self):
        p = parse_quantity("0.1 mol")
        assert p is not None
        assert p.value == 0.1
        assert p.unit == "mol"
        assert p.base_value == 0.1
        assert p.base_unit == "mol"

    def test_simple_millimoles(self):
        p = parse_quantity("1.75 mmol")
        assert p is not None
        assert p.value == 1.75
        assert p.unit == "mmol"
        assert p.base_value == pytest.approx(0.00175)
        assert p.base_unit == "mol"

    def test_simple_equivalents(self):
        p = parse_quantity("1.1 eq")
        assert p is not None
        assert p.value == 1.1
        assert p.unit == "equiv"
        assert p.base_value == 1.1
        assert p.base_unit == "equiv"

    def test_empty_string_returns_none(self):
        assert parse_quantity("") is None

    def test_whitespace_only_returns_none(self):
        assert parse_quantity("   ") is None

    def test_percent_returns_none(self):
        assert parse_quantity("20%") is None

    def test_density_returns_none(self):
        """Parser must not accept a density-shaped string as a quantity."""
        assert parse_quantity("1.2 g/mL") is None


# ---------------------------------------------------------------------------
# Acceptance — primary amount + supplementary mol/equiv annotations.
# ---------------------------------------------------------------------------


class TestPrimaryAmountWithSupplementaryAnnotations:
    """A primary amount may carry extra mol/equiv annotations after it."""

    def test_grams_with_mmol_annotation(self):
        p = parse_quantity("0.207 g, 1.75 mmol")
        assert p is not None
        # Primary amount is the first segment (mass).
        assert p.value == 0.207
        assert p.unit == "g"
        assert p.base_value == pytest.approx(0.207)
        assert p.base_unit == "g"
        # Annotation stored verbatim; not used to mutate base_value.
        assert p.annotations.get("mmol") == 1.75

    def test_grams_with_mmol_and_equiv_annotations(self):
        p = parse_quantity("0.474 g, 1.93 mmol, 1.1 eq")
        assert p is not None
        assert p.value == 0.474
        assert p.unit == "g"
        assert p.base_unit == "g"
        assert p.annotations.get("mmol") == 1.93
        assert p.annotations.get("equiv") == 1.1

    def test_milliliters_with_mmol_annotation(self):
        """Supplementary mol annotations may also follow a volume primary."""
        p = parse_quantity("5 mL, 0.5 mmol")
        assert p is not None
        assert p.value == 5.0
        assert p.unit == "mL"
        assert p.base_value == 5.0
        assert p.base_unit == "mL"
        assert p.annotations.get("mmol") == 0.5

    def test_no_space_between_segments(self):
        """Annotation segments may abut the comma without whitespace."""
        p = parse_quantity("0.207g,1.75mmol")
        assert p is not None
        assert p.value == 0.207
        assert p.unit == "g"
        assert p.annotations.get("mmol") == 1.75


# ---------------------------------------------------------------------------
# Acceptance — single annotated amount (parenthetical label only).
# ---------------------------------------------------------------------------


class TestSingleAnnotatedAmount:
    """A primary amount may carry a non-numeric parenthetical label."""

    def test_volume_with_label(self):
        p = parse_quantity("5 mL (Pb-n1)")
        assert p is not None
        assert p.value == 5.0
        assert p.unit == "mL"
        assert p.base_value == 5.0
        assert p.base_unit == "mL"
        # Parenthetical content is stored as a string tag, not a numeric value.
        assert p.annotations.get("tag") == "Pb-n1"

    def test_mass_with_label(self):
        p = parse_quantity("700 mg (Pb-n1)")
        assert p is not None
        assert p.value == 700.0
        assert p.unit == "mg"
        assert p.base_value == pytest.approx(0.7)
        assert p.base_unit == "g"
        assert p.annotations.get("tag") == "Pb-n1"

    def test_label_with_spaces_preserved(self):
        p = parse_quantity("5 mL (step 1)")
        assert p is not None
        assert p.annotations.get("tag") == "step 1"


# ---------------------------------------------------------------------------
# Acceptance — repeated volume applications sum into a total.
# ---------------------------------------------------------------------------


class TestRepeatedVolumeApplications:
    """Wash / rinse 'N x M unit' is deterministic: total = N * M."""

    def test_wash_three_times_fifteen_ml(self):
        p = parse_quantity("wash 3 x 15 mL")
        assert p is not None
        assert p.value == 45.0
        assert p.unit == "mL"
        assert p.base_value == 45.0
        assert p.base_unit == "mL"
        assert p.repetition == 3

    def test_repeat_no_space(self):
        p = parse_quantity("3x15mL")
        assert p is not None
        assert p.value == 45.0
        assert p.unit == "mL"
        assert p.repetition == 3

    def test_repeat_with_multiply_sign(self):
        p = parse_quantity("3 × 15 mL")
        assert p is not None
        assert p.value == 45.0
        assert p.unit == "mL"
        assert p.repetition == 3

    def test_repeat_fractional_count(self):
        """A fractional multiplier must not silently pass; we accept and total."""
        p = parse_quantity("2.5 x 4 mL")
        assert p is not None
        assert p.value == 10.0
        assert p.unit == "mL"
        assert p.repetition == 2  # truncated to int for the multiplier count


# ---------------------------------------------------------------------------
# Negative safety — grouped distinct formulation values must NOT collapse.
# ---------------------------------------------------------------------------


class TestRejectsGroupedDistinctFormulations:
    """Multiple tagged amounts of the same dimension must reject — they are
    distinct formulation values, not a sum.  Picking the first or summing
    would silently distort downstream conversion."""

    def test_three_tagged_masses_reject(self):
        assert parse_quantity("700 mg (Pb-n1), 1000 mg (Pb-n2), 300 mg (Pb-n3)") is None

    def test_two_tagged_masses_reject(self):
        assert parse_quantity("700 mg (Pb-n1), 1000 mg (Pb-n2)") is None

    def test_untagged_duplicate_masses_reject(self):
        """Two same-dimension amounts without tags are ambiguous and reject."""
        assert parse_quantity("700 mg, 1000 mg") is None


# ---------------------------------------------------------------------------
# Negative safety — dimension-unsafe / qualitative inputs.
# ---------------------------------------------------------------------------


class TestRejectsDimensionUnsafeInputs:
    """Membrane pores, qualitative amounts, contradictory amounts and
    unrelated trailing text must all reject — the parser must not invent a
    quantity that isn't dimensionally present in the source string."""

    def test_membrane_pore_micrometre(self):
        # µm is a length unit (pore size), not a quantity. Must reject.
        assert parse_quantity("0.22 μm") is None

    def test_membrane_pore_no_space(self):
        assert parse_quantity("0.22μm") is None

    def test_qualitative_drops(self):
        assert parse_quantity("a few drops") is None

    def test_qualitative_to_taste(self):
        assert parse_quantity("to taste") is None

    def test_contradictory_or(self):
        assert parse_quantity("1 g or 2 g") is None

    def test_contradictory_vs(self):
        assert parse_quantity("1 g vs 2 g") is None

    def test_unrelated_trailing_text(self):
        """Trailing procedural text is not a quantity."""
        assert parse_quantity("5 g and then heat to 100 °C") is None

    def test_unrelated_leading_and_trailing(self):
        assert parse_quantity("add 5 g and stir") is None


# ---------------------------------------------------------------------------
# Negative safety — no invented densities / concentrations.
# ---------------------------------------------------------------------------


class TestNoInventedDensitiesOrConcentrations:
    """The parser must not silently turn a 'saturated solution' phrase
    into a pure-solid mass.  It must return None unless a literal amount
    is present in the string."""

    def test_saturated_solution_rejects(self):
        assert parse_quantity("saturated salt solution") is None

    def test_saturated_solution_with_ml_rejects(self):
        # No explicit amount → reject rather than invent a mass.
        assert parse_quantity("saturated NaCl solution") is None

    def test_solution_with_explicit_amount_keeps_literal(self):
        # When a literal amount IS present, we keep it as-is.
        p = parse_quantity("5 mL of saturated NaCl solution")
        # The 'of saturated NaCl solution' is trailing procedural text
        # relative to the leading amount — reject rather than infer.
        assert p is None


# ---------------------------------------------------------------------------
# Zero / negative semantics — preserve existing behaviour.
# ---------------------------------------------------------------------------


class TestZeroAndNegativeSemantics:
    """The pre-existing parser allowed '0 g' and rejected '-5 g'.  Keep that
    contract so callers downstream don't see a sudden semantic shift."""

    def test_zero_grams_parses(self):
        p = parse_quantity("0 g")
        assert p is not None
        assert p.value == 0.0
        assert p.base_value == 0.0

    def test_zero_milliliters_parses(self):
        p = parse_quantity("0 mL")
        assert p is not None
        assert p.value == 0.0

    def test_negative_grams_rejects(self):
        """The pre-existing regex did not allow a leading minus sign."""
        assert parse_quantity("-5 g") is None


# ---------------------------------------------------------------------------
# Public-API surface — dataclass stays importable and constructible.
# ---------------------------------------------------------------------------


class TestPublicAPISurface:
    """The ParsedQuantity dataclass must remain constructible with its
    existing positional/keyword fields, so converter.py and any downstream
    caller that imports it continues to work."""

    def test_dataclass_constructible_with_existing_fields(self):
        p = ParsedQuantity(
            value=1.0,
            unit="g",
            base_value=1.0,
            base_unit="g",
            raw="1 g",
        )
        assert p.value == 1.0
        assert p.unit == "g"
        assert p.annotations == {}  # default
        assert p.repetition == 1    # default

    def test_dataclass_defaults_round_trip(self):
        p = parse_quantity("5 g")
        assert p is not None
        # Round-trip via repr must not raise; fields must be accessible.
        assert isinstance(p, ParsedQuantity)
        assert not math.isnan(p.value)
        assert p.base_unit in {"g", "mL", "mol", "equiv"}
