"""Regression coverage for parser labels such as ``DMF (N,N-dimethylformamide)``."""

import asyncio

import cache
import converter
import pytest


DMF_REQUESTED = "DMF (N,N-dimethylformamide)"
PD_REQUESTED = "Pd(PPh3)4 (tetrakis(triphenylphosphine)palladium(0))"


def _record(cid: int, molecular_weight: float, density: float | None = None) -> dict:
    return {
        "cid": cid,
        "molecular_weight": molecular_weight,
        "density_g_per_ml": density,
        "canonical_smiles": None,
        "molecular_formula": "test",
        "ghs_hazards": [],
        "green_alternatives": [],
        "citations": [],
    }


def _offline_cached_aliases(monkeypatch):
    records = {
        "n,n-dimethylformamide": _record(6228, 73.09, 0.944),
        "tetrakis(triphenylphosphine)palladium(0)": _record(11979704, 1155.6),
    }
    cache_keys: list[str] = []

    def fake_get(key):
        cache_keys.append(key)
        return records.get(key.casefold().strip())

    monkeypatch.setattr(cache, "get", fake_get)
    monkeypatch.setattr(cache, "put", lambda key, value: None)

    async def no_remote_lookup(name):
        raise AssertionError(f"combined aliases must resolve from the exact cache, not PubChem: {name}")

    monkeypatch.setattr(converter, "lookup_chemical", no_remote_lookup)
    monkeypatch.setattr(converter, "get_vetted_evidence", lambda name, cid: {"why_replacement": [], "citations": []})

    async def no_ghs_lookup(cid):
        return []

    monkeypatch.setattr(converter, "lookup_hcodes_with_details", no_ghs_lookup)
    return cache_keys


@pytest.mark.parametrize(
    ("requested_name", "quantity", "expected_canonical", "expected_g"),
    [
        (DMF_REQUESTED, "100 mL", "N,N-Dimethylformamide", 94.4),
        (PD_REQUESTED, "0.58 g", "Tetrakis(triphenylphosphine)palladium(0)", 0.58),
    ],
)
def test_combined_alias_uses_exact_cached_identity_and_keeps_requested_name(
    monkeypatch, requested_name, quantity, expected_canonical, expected_g
):
    cache_keys = _offline_cached_aliases(monkeypatch)

    result = asyncio.run(converter.convert(requested_name, quantity))

    assert result.chemical_name == requested_name
    assert result.input_quantity == quantity
    assert result.data_source == "cache"
    assert result.cached is True
    assert result.quantity_g == expected_g
    assert expected_canonical in cache_keys


def test_combined_alias_preserves_internal_formula_parentheses(monkeypatch):
    cache_keys = _offline_cached_aliases(monkeypatch)

    result = asyncio.run(converter.convert(PD_REQUESTED, "0.58 g"))

    assert result.chemical_name == PD_REQUESTED
    assert "Pd(PPh3)4" not in cache_keys
    assert "palladium(0)" not in cache_keys
    assert "Tetrakis(triphenylphosphine)palladium(0)" in cache_keys


def test_unrelated_combined_name_does_not_fuzzy_match_cached_identity(monkeypatch):
    cache_keys = _offline_cached_aliases(monkeypatch)

    async def fake_lookup(name):
        assert name == "DMF-like material (not dimethylformamide)"
        return _record(1, 10.0)

    monkeypatch.setattr(converter, "lookup_chemical", fake_lookup)
    result = asyncio.run(converter.convert("DMF-like material (not dimethylformamide)", "2 g"))

    assert result.chemical_name == "DMF-like material (not dimethylformamide)"
    assert result.data_source == "pubchem"
    assert "N,N-Dimethylformamide" not in cache_keys
    assert "Tetrakis(triphenylphosphine)palladium(0)" not in cache_keys
    assert "DMF-like material (not dimethylformamide)" in cache_keys


def test_repeated_combined_aliases_keep_their_own_quantities(monkeypatch):
    _offline_cached_aliases(monkeypatch)

    first = asyncio.run(converter.convert(DMF_REQUESTED, "10 mL"))
    second = asyncio.run(converter.convert(DMF_REQUESTED, "20 mL"))

    assert (first.chemical_name, first.input_quantity, first.quantity_g) == (DMF_REQUESTED, "10 mL", 9.44)
    assert (second.chemical_name, second.input_quantity, second.quantity_g) == (DMF_REQUESTED, "20 mL", 18.88)
