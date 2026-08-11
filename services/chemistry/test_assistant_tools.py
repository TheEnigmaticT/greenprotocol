import asyncio
import pytest

import assistant_tools
from assistant_tools import AssistantToolRequest, execute_assistant_tool
from solvent_evidence_store import SolventEvidenceUnavailableError

from fastapi.testclient import TestClient

from main import app


def test_chem21_tool_returns_scores_and_prat_citation():
    with TestClient(app) as client:
        response = client.post(
            "/assistant-tools",
            json={"operation": "chem21", "chemical_name": "DMF"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["source"] == "CHEM21"
    assert payload["data"]["classification"] == "hazardous"
    assert payload["data"]["scores"] == {
        "safety": 3,
        "health": 9,
        "environment": 5,
        "overall": 9,
    }
    assert payload["citations"] == [{
        "source_id": "CHEM21",
        "source_name": "CHEM21 Solvent Selection Guide",
        "citation": "Prat et al., Green Chem., 2016, 18, 288-296",
        "url": "https://doi.org/10.1039/C5GC01008J",
        "doi": "10.1039/C5GC01008J",
    }]


def test_pubchem_tool_returns_hazard_provenance():
    with TestClient(app) as client:
        response = client.post(
            "/assistant-tools",
            json={"operation": "pubchem", "chemical_name": "DMF"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["source"] in {"PubChem", "Local fallback"}
    assert payload["data"]["molecular_formula"] == "C3H7NO"
    assert any(hazard["code"] == "H360D" for hazard in payload["data"]["ghs_hazards"])


def test_rdkit_tool_calculates_resolved_structure_properties():
    with TestClient(app) as client:
        response = client.post(
            "/assistant-tools",
            json={"operation": "rdkit", "chemical_name": "DMF"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["source"] == "RDKit"
    assert payload["data"]["molecular_weight"] == 73.095
    assert payload["data"]["canonical_smiles"] == "CN(C)C=O"


def test_configured_service_rejects_tool_request_without_token(monkeypatch):
    monkeypatch.setenv("CHEMISTRY_SERVICE_TOKEN", "test-token")

    with TestClient(app) as client:
        response = client.post(
            "/assistant-tools",
            json={"operation": "chem21", "chemical_name": "DMF"},
        )

    assert response.status_code == 401


@pytest.mark.parametrize("payload", [
    {
        "operation": "solvent_evidence",
        "mode": "density",
        "solvent": "DMF",
        "temperature_k": 298.15,
    },
    {"operation": "solvent_hazard", "solvent": "DMF"},
    {
        "operation": "solvent_screening",
        "solute_smiles": "CCO",
        "current_solvent": "DMF",
        "temperature_k": 298.15,
    },
])
def test_configured_service_rejects_all_local_operations_without_token(monkeypatch, payload):
    monkeypatch.setenv("CHEMISTRY_SERVICE_TOKEN", "test-token")

    with TestClient(app) as client:
        response = client.post("/assistant-tools", json=payload)

    assert response.status_code == 401


def test_chem21_tool_preserves_dmso_compatibility_alias():
    with TestClient(app) as client:
        response = client.post(
            "/assistant-tools",
            json={"operation": "chem21", "chemical_name": "dmso"},
        )

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["chemical_name"] == "Dimethyl sulfoxide"


def test_chem21_tool_reports_unavailable_index(monkeypatch):
    def unavailable(_: str):
        raise SolventEvidenceUnavailableError("CHEM21 index is unavailable")

    monkeypatch.setattr(assistant_tools, "lookup_solvent_with_evidence", unavailable)
    result = asyncio.run(
        execute_assistant_tool(AssistantToolRequest(operation="chem21", chemical_name="DMF"))
    )

    assert result.status == "unavailable"
    assert result.source == "CHEM21"
    assert result.warnings == ["CHEM21 data is unavailable: CHEM21 index is unavailable"]
