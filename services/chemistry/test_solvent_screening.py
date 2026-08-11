import asyncio
from dataclasses import replace

import pytest

from solvent_evidence_store import HazardProfile


def _profile(solvent: str, **levels: bool) -> HazardProfile:
    return HazardProfile(
        solvent=solvent,
        cid=1,
        hcodes=(),
        cmr=levels.get("cmr", False),
        acute=levels.get("acute", False),
        organ=levels.get("organ", False),
        health=levels.get("health", False),
        environmental=levels.get("environmental", False),
        physical=levels.get("physical", False),
        source_url="https://example.test/ghs",
        snapshot_path="snapshot.json",
        snapshot_sha256="a" * 64,
        retrieved_at="2026-08-11T00:00:00Z",
        state="complete",
    )


class FixtureStore:
    def __init__(self, mutation: str = "valid"):
        self.mutation = mutation
        self.calls = []

    def screening_solubility(self, normalized_solute_smiles: str, solvent: str, temperature_k: float, *, limit: int):
        self.calls.append(("screening_solubility", normalized_solute_smiles, solvent, temperature_k, limit))
        candidate_solute = "CCO" if self.mutation != "different_structure" else "CC"
        candidate_temperature = 298.15 if self.mutation != "temperature_303_15" else 303.15
        candidate_solubility = 0.30 if self.mutation != "lower_solubility" else 0.05
        records = [
            {
                "solute_smiles": "CCO",
                "solvent": "DMF",
                "temperature_k": 298.15,
                "solubility_mole_fraction": 0.10,
                "source": "10.1000/current",
                "measurements": {"Temperature_K": "298.15"},
                "units": {"Temperature_K": "K"},
                "raw_values": {"Solubility(mole_fraction)": "0.10"},
            },
            {
                "solute_smiles": candidate_solute,
                "solvent": "Acetonitrile",
                "temperature_k": candidate_temperature,
                "solubility_mole_fraction": candidate_solubility,
                "source": "10.1000/candidate",
                "measurements": {"Temperature_K": str(candidate_temperature)},
                "units": {"Temperature_K": "K"},
                "raw_values": {"Solubility(mole_fraction)": str(candidate_solubility)},
            },
        ]
        matched = [record for record in records if record["solvent"] == solvent]
        return matched[:limit], len(matched) > limit

    def hazard_profile(self, solvent: str):
        if self.mutation == "missing_ghs" and solvent == "Acetonitrile":
            return None
        if solvent == "DMF":
            return _profile(
                "N,N-Dimethylformamide",
                cmr=False if self.mutation == "adds_h350" else True,
                acute=True,
                organ=True,
                environmental=True,
                physical=True,
            )
        if self.mutation == "adds_h350":
            return _profile("Acetonitrile", cmr=True, acute=False, organ=False, environmental=False, physical=False)
        return _profile("Acetonitrile", cmr=False, acute=False, organ=True, environmental=True, physical=True)

    def lookup_chem21(self, solvent: str):
        if solvent == "DMF":
            return {"name": "N,N-Dimethylformamide", "replacements": ["Acetonitrile"]}
        return {"name": solvent}


def _candidates_for(store: FixtureStore):
    import solvent_screening

    return solvent_screening.screen_candidates("CCO", "DMF", 298.15, store=store)


def test_screening_requires_exact_structure_same_temperature_and_complete_non_regressing_hazards():
    candidates = _candidates_for(FixtureStore())

    assert [candidate.solvent for candidate in candidates] == ["Acetonitrile"]
    assert candidates[0].solubility_mole_fraction >= candidates[0].current_solubility_mole_fraction
    assert candidates[0].recommendation == "laboratory_screening"
    assert candidates[0].chem21_relation == "CHEM21 lists Acetonitrile as a replacement for N,N-Dimethylformamide."
    assert candidates[0].hazard_comparison == {
        "cmr": {"current": 1, "candidate": 0},
        "acute": {"current": 1, "candidate": 0},
        "organ": {"current": 1, "candidate": 1},
        "environment": {"current": 1, "candidate": 1},
        "physical": {"current": 1, "candidate": 1},
    }
    assert {"source": "10.1000/current"} in candidates[0].citations
    assert {"source": "10.1000/candidate"} in candidates[0].citations
    assert any(citation.get("source_id") == "CHEM21" for citation in candidates[0].citations)
    assert any(citation.get("snapshot_path") == "snapshot.json" for citation in candidates[0].citations)
    assert "compatibility" in candidates[0].warnings[0]


def test_screening_caps_returned_measurements_and_reports_truncation():
    class UnboundedFixtureStore(FixtureStore):
        def screening_solubility(self, normalized_solute_smiles, solvent, temperature_k, *, limit):
            rows, _ = super().screening_solubility(
                normalized_solute_smiles, solvent, temperature_k, limit=limit
            )
            return rows * 21, False

    candidate = _candidates_for(UnboundedFixtureStore())[0]

    assert len(candidate.current_measurements) == 20
    assert len(candidate.candidate_measurements) == 20
    assert "Results were truncated to the first 20 raw measurements." in candidate.warnings


@pytest.mark.parametrize("mutation", ["different_structure", "temperature_303_15", "lower_solubility", "missing_ghs", "adds_h350"])
def test_screening_rejects_every_failed_gate(mutation):
    assert _candidates_for(FixtureStore(mutation)) == []


def test_local_requests_reject_malformed_and_nonfinite_inputs_before_store_queries(monkeypatch):
    import assistant_tools

    store = FixtureStore()
    monkeypatch.setattr(assistant_tools, "get_store", lambda: store)
    request = assistant_tools.AssistantToolRequest.model_validate(
        {
            "operation": "solvent_evidence",
            "mode": "single_solubility",
            "solute_smiles": "not a smiles",
            "solvent": "DMF",
            "temperature_k": 298.15,
        }
    )

    result = asyncio.run(assistant_tools.execute_assistant_tool(request))
    assert result.status == "not_found"
    assert store.calls == []

    with pytest.raises(Exception):
        assistant_tools.AssistantToolRequest.model_validate(
            {
                "operation": "solvent_evidence",
                "mode": "density",
                "solvent": "DMF",
                "temperature_k": float("inf"),
            }
        )


def test_local_evidence_caps_raw_measurements_and_never_calls_pubchem(monkeypatch):
    import assistant_tools

    class ManyRowsStore(FixtureStore):
        def single_solubility(self, solute_smiles, solvent, temperature_k, *, limit=None):
            self.calls.append(("single_solubility", solute_smiles, solvent, temperature_k, limit))
            return [{"id": index} for index in range(limit or 21)]

    store = ManyRowsStore()
    monkeypatch.setattr(assistant_tools, "get_store", lambda: store)
    monkeypatch.setattr(assistant_tools, "lookup_chemical", lambda _: pytest.fail("PubChem must not be called"))
    request = assistant_tools.AssistantToolRequest.model_validate(
        {
            "operation": "solvent_evidence",
            "mode": "single_solubility",
            "solute_smiles": "CCO",
            "solvent": "DMF",
            "temperature_k": 298.15,
        }
    )

    result = asyncio.run(assistant_tools.execute_assistant_tool(request))
    assert result.status == "ok"
    assert len(result.data["measurements"]) == 20
    assert result.warnings == ["Results were truncated to the first 20 raw measurements."]
    assert store.calls == [("single_solubility", "CCO", "DMF", 298.15, 21)]
