"""Regression tests for converter.convert().

Guards the 2026-06 -> 2026-08 outage where converter.py called
resolve_synonym() without importing it, so every convert() raised
NameError, /batch returned data_source="error" for every chemical, and
the whole deterministic pipeline was silently dead. See
docs/audits/2026-08-13-full-audit.md (Critical #1).

These run fully offline: PubChem/GHS lookups are monkeypatched so the
test exercises the name-resolution + unit-conversion path without network.
"""

import asyncio

import cache
import converter


def test_resolve_synonym_is_importable_in_converter_namespace():
    """Direct guard: the name convert() depends on must be bound here.

    If someone drops the `from synonyms import resolve_synonym` import
    again, this fails immediately instead of only surfacing as a runtime
    NameError swallowed by /batch's per-chemical try/except.
    """
    assert callable(getattr(converter, "resolve_synonym", None))


def _offline(monkeypatch):
    """Stub out cache + network so convert() is deterministic and local."""
    monkeypatch.setattr(cache, "get", lambda key: None)
    monkeypatch.setattr(cache, "put", lambda key, value: None)
    monkeypatch.setattr(cache, "add_missing", lambda key: None)

    async def fake_lookup_chemical(name):
        # DMF's real numbers; enough to exercise mL->g->mol conversion.
        return {
            "cid": 6228,
            "molecular_weight": 73.09,
            "density_g_per_ml": 0.944,
            "canonical_smiles": None,
            "molecular_formula": "C3H7NO",
            "_data_source": "pubchem",
        }

    async def fake_ghs(cid):
        return []

    monkeypatch.setattr(converter, "lookup_chemical", fake_lookup_chemical)
    monkeypatch.setattr(converter, "lookup_hcodes_with_details", fake_ghs)
    monkeypatch.setattr(
        converter,
        "get_vetted_evidence",
        lambda name, cid: {"why_replacement": [], "citations": []},
    )


def test_convert_does_not_raise_nameerror(monkeypatch):
    """The exact regression: convert() must get past resolve_synonym()."""
    _offline(monkeypatch)
    result = asyncio.run(converter.convert("DMF", "10 mL"))
    # Synonym resolution actually happened (DMF -> full IUPAC name).
    assert result.chemical_name == "N,N-Dimethylformamide"
    assert result.data_source == "pubchem"
    # mL -> g via density, then g -> mol via MW — real deterministic output,
    # not the data_source="error" the outage produced.
    assert result.quantity_g == round(10 * 0.944, 6)
    assert result.quantity_mol is not None


def test_indefinite_material_is_not_sent_to_pubchem_or_marked_missing(monkeypatch):
    _offline(monkeypatch)

    async def fail_lookup(_name):
        raise AssertionError("indefinite materials must not be sent to PubChem")

    monkeypatch.setattr(converter, "lookup_chemical", fail_lookup)
    result = asyncio.run(converter.convert("brine", "100 mL"))

    assert result.chemical_name == "brine"
    assert result.data_source == "indefinite"
    assert result.quantity_kg is None
    assert any("indefinite composition" in warning for warning in result.warnings)
