"""A failed GHS fetch must not be cached as no hazards."""

import asyncio

import cache
import converter
import ghs


def test_failed_fetch_is_not_confirmed(monkeypatch):
    async def no_document(url, label):
        return None

    monkeypatch.setattr(ghs, "fetch_pubchem_json", no_document)

    async def run():
        details = await ghs.lookup_hcodes_with_details(313)
        return details, ghs.last_ghs_status()

    details, status = asyncio.run(run())
    assert details == []
    assert status == "failed"


def test_local_table_confirms_when_pubchem_misses(monkeypatch):
    async def no_document(url, label):
        return None

    monkeypatch.setattr(ghs, "fetch_pubchem_json", no_document)
    monkeypatch.setattr(ghs, "lookup_local_hcodes", lambda cid: ["H314"])
    details = asyncio.run(ghs.lookup_hcodes_with_details(313))
    assert [item["code"] for item in details] == ["H314"]
    assert ghs.last_ghs_status() == "confirmed"


def test_poisoned_empty_cache_is_replaced_when_a_read_succeeds(monkeypatch):
    stored = {}
    record = {
        "cid": 313,
        "molecular_weight": 36.46,
        "density_g_per_ml": 1.0,
        "canonical_smiles": "Cl",
        "molecular_formula": "ClH",
        "ghs_hazards": [],
        "green_alternatives": [],
        "citations": [],
    }

    monkeypatch.setattr(cache, "get", lambda key: dict(record))
    monkeypatch.setattr(cache, "put", lambda key, value: stored.__setitem__(key, value))

    async def fake_ghs(cid):
        ghs._last_ghs_status.set("confirmed")
        return [{
            "code": "H314",
            "description": "Causes severe skin burns and eye damage",
            "source": "test",
        }]

    monkeypatch.setattr(converter, "lookup_hcodes_with_details", fake_ghs)
    result = asyncio.run(converter.convert("hydrochloric acid", "5 mL"))
    assert any(item["code"] == "H314" for item in result.ghs_hazards)
    saved = next(iter(stored.values()))
    assert saved["ghs_status"] == "confirmed"
    assert saved["ghs_hazards"][0]["code"] == "H314"


def test_failed_refetch_drops_the_empty_list(monkeypatch):
    stored = {}
    record = {
        "cid": 313,
        "molecular_weight": 36.46,
        "density_g_per_ml": 1.0,
        "canonical_smiles": "Cl",
        "molecular_formula": "ClH",
        "ghs_hazards": [],
        "green_alternatives": [],
        "citations": [],
    }
    monkeypatch.setattr(cache, "get", lambda key: dict(record))
    monkeypatch.setattr(cache, "put", lambda key, value: stored.__setitem__(key, value))

    async def fake_ghs(cid):
        ghs._last_ghs_status.set("failed")
        return []

    monkeypatch.setattr(converter, "lookup_hcodes_with_details", fake_ghs)
    result = asyncio.run(converter.convert("hydrochloric acid", "5 mL"))
    assert result.ghs_hazards == []
    saved = next(iter(stored.values()))
    assert "ghs_hazards" not in saved
    assert "ghs_status" not in saved


def test_nested_pubchem_section_is_read():
    data = {
        "Record": {
            "Section": [{
                "TOCHeading": "Safety and Hazards",
                "Section": [{
                    "TOCHeading": "Hazards Identification",
                    "Section": [{
                        "TOCHeading": "GHS Classification",
                        "Information": [{
                            "Name": "GHS Hazard Statements",
                            "Value": {"StringWithMarkup": [{
                                "String": "H314: Causes severe skin burns and eye damage [Danger Skin corrosion/irritation]",
                            }]},
                        }],
                    }],
                }],
            }],
        },
    }
    found, hazards = ghs.parse_hcodes_with_details(data)
    assert found is True
    assert hazards[0]["code"] == "H314"
    assert "severe skin burns" in hazards[0]["description"]
