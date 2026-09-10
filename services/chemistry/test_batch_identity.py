"""Batch occurrence contract: aliases retain request identity across the service boundary."""

import asyncio

import main
from models import BatchRequest, ConvertResponse


def test_batch_forwards_and_echoes_request_identity(monkeypatch):
    async def fake_convert(name: str, quantity: str, request_id: str | None):
        assert (name, quantity, request_id) == ("DMF", "10 mL", "step-1:chemical-0")
        return ConvertResponse(
            chemical_name="N,N-Dimethylformamide",
            requested_chemical_name=name,
            request_id=request_id,
            input_quantity=quantity,
            data_source="pubchem",
        )

    monkeypatch.setattr(main, "convert", fake_convert)

    response = asyncio.run(main.batch_convert(BatchRequest(chemicals=[
        {"chemical_name": "DMF", "quantity": "10 mL", "request_id": "step-1:chemical-0"},
    ])))

    assert response.results[0].requested_chemical_name == "DMF"
    assert response.results[0].chemical_name == "N,N-Dimethylformamide"
    assert response.results[0].request_id == "step-1:chemical-0"
