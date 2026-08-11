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
        "safety": 1,
        "health": 7,
        "environment": 3,
        "overall": 7,
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
