"""Regression coverage for the authenticated deterministic score endpoint."""

import asyncio

from main import score_protocol
from scoring.models import ScoringRequest


def test_score_endpoint_returns_unavailable_energy_score_without_temperature():
    """A minimal protocol returns an unavailable P6 score when temperature is absent."""
    request = ScoringRequest(
        chemicals=[{
            "name": "DMF",
            "role": "solvent",
            "quantity": "1 mL",
            "quantity_g": 0.95,
            "quantity_kg": 0.00095,
            "quantity_mol": 0.01299767,
            "molecular_weight": 73.09,
            "step_number": 1,
        }],
        steps=[{
            "stepNumber": 1,
            "description": "DMF solvent screening",
            "chemicals": [{"name": "DMF", "role": "solvent"}],
        }],
        protocol_text="DMF was used as the reaction solvent.",
    )

    response = asyncio.run(score_protocol(request))

    assert response.scores
    assert next(score for score in response.scores if score.principle_number == 6).confidence == "unavailable"
